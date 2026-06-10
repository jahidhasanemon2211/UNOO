import React, { useEffect, useState, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState, Card, CardColor, ClientToServerEvents, ServerToClientEvents } from './types';
import { Users, Copy, Check, Play, UserPlus, AlertCircle, WifiOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { audioSystem } from './audio';
import confetti from 'canvas-confetti';
import { mockSocket } from './mockSocket';

const realSocket: Socket<ServerToClientEvents, ClientToServerEvents> = io('/', {
  transports: ['websocket']
});

export default function App() {
  const [offlineMode, setOfflineMode] = useState(false);
  const activeSocket = useMemo(() => offlineMode ? mockSocket : realSocket, [offlineMode]);

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myHand, setMyHand] = useState<Card[]>([]);
  const [nickname, setNickname] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [funnyText, setFunnyText] = useState<{ id: number, text: string } | null>(null);
  const [delayedText, setDelayedText] = useState<{ id: number, text: string } | null>(null);
  
  const [discardPileUI, setDiscardPileUI] = useState<(Card & { key: string, rotate: number, x: number, y: number })[]>([]);
  
  const [isDealing, setIsDealing] = useState(false);
  const prevStatusRef = React.useRef(gameState?.status);
  
  useEffect(() => {
    if (gameState?.status === 'playing' && prevStatusRef.current === 'waiting') {
      setIsDealing(true);
      setTimeout(() => setIsDealing(false), 2500);
    }
    prevStatusRef.current = gameState?.status;
  }, [gameState?.status]);
  
  useEffect(() => {
    if (gameState?.status === 'playing') {
      const timer = setTimeout(() => {
        const id = Date.now();
        setDelayedText({ id, text: 'কিরে এতো লেট করস কেনো তুই? 😤' });
        setTimeout(() => {
          setDelayedText(prev => prev?.id === id ? null : prev);
        }, 4000);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [gameState?.currentPlayerIndex, gameState?.status]);

  useEffect(() => {
    const handleStateUpdate = (state: GameState, hand?: Card[]) => {
      console.log('[Client] Received game_state_update:', state, 'hand:', hand);
      setGameState(prev => {
        console.log('[Client] Setting new gameState. Previous:', prev?.status, 'New:', state.status);
        if (prev?.status !== 'finished' && state.status === 'finished') {
          audioSystem.playWin();
          
          const duration = 3000;
          const end = Date.now() + duration;

          const frame = () => {
            confetti({
              particleCount: 5,
              angle: 60,
              spread: 55,
              origin: { x: 0 },
              colors: ['#ef4444', '#3b82f6', '#22c55e', '#eab308']
            });
            confetti({
              particleCount: 5,
              angle: 120,
              spread: 55,
              origin: { x: 1 },
              colors: ['#ef4444', '#3b82f6', '#22c55e', '#eab308']
            });

            if (Date.now() < end) {
              requestAnimationFrame(frame);
            }
          };
          frame();
        }
        return state;
      });
      if (hand) setMyHand(hand);
      setError(null);
    };

    const handleRoomCreated = (code: string) => {};
    
    const handleError = (msg: string) => {
      setError(msg);
      setTimeout(() => setError(null), 3000);
    };

    const handlePlayAnimation = (actorId: string, action: string, cardValue?: string) => {
       console.log(`${actorId} performed ${action} with ${cardValue}`);
       if (action === 'played_card') {
           audioSystem.playPlayCard();
           if (cardValue) {
               let text = '';
               if (cardValue === 'Draw2') text = 'নে ভাই ২ টা খা! 😝';
               else if (cardValue === 'Skip') text = 'তোর সিরিয়াল নাই, মুড়ি খা! 😂';
               else if (cardValue === 'WildDraw4') text = '৪ টা খা, আর কান্দে যা! 😭';
               else if (cardValue === 'Reverse') text = 'উলালা, উল্টা ঘুরুক! 🔄';
               else if (cardValue === 'Wild') text = 'চুপ চাপ রং মিলা! 🎨';
               
               if (text) {
                   const id = Date.now();
                   setFunnyText({ id, text });
                   setTimeout(() => {
                       setFunnyText(prev => prev?.id === id ? null : prev);
                   }, 3000);
               }
           }
       }
       if (action === 'drew_card') audioSystem.playDrawCard();
    };

    activeSocket.on('game_state_update', handleStateUpdate as any);
    activeSocket.on('room_created', handleRoomCreated as any);
    activeSocket.on('error', handleError as any);
    activeSocket.on('play_animation', handlePlayAnimation as any);

    return () => {
      activeSocket.off('game_state_update', handleStateUpdate as any);
      activeSocket.off('room_created', handleRoomCreated as any);
      activeSocket.off('error', handleError as any);
      activeSocket.off('play_animation', handlePlayAnimation as any);
    };
  }, [activeSocket]);

  useEffect(() => {
    if (gameState?.topCard) {
      setDiscardPileUI(prev => {
        if (prev.length > 0 && prev[prev.length - 1].id === gameState.topCard!.id) {
          return prev;
        }
        const newCard = {
          ...gameState.topCard!,
          key: gameState.topCard!.id + '-' + Date.now(),
          rotate: (Math.random() - 0.5) * 60,
          x: (Math.random() - 0.5) * 30,
          y: (Math.random() - 0.5) * 30,
        };
        const next = [...prev, newCard];
        if (next.length > 8) next.shift(); // keep last 8 cards
        return next;
      });
    }
  }, [gameState?.topCard]);

  const copyRoomCode = () => {
    if (gameState?.roomCode) {
      navigator.clipboard.writeText(gameState.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[Client] handleCreateRoom clicked. Nickname:', nickname);
    audioSystem.init();
    audioSystem.resume();
    if (!nickname.trim()) {
      console.log('[Client] Nickname empty!');
      return setError('Nickname required');
    }
    console.log('[Client] Emitting create_room event with activeSocket:', activeSocket.id);
    activeSocket.emit('create_room', nickname.trim());
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    audioSystem.init();
    audioSystem.resume();
    if (!nickname.trim()) return setError('Nickname required');
    if (!roomCodeInput.trim()) return setError('Room code required');
    setOfflineMode(false);
    activeSocket.emit('join_room', roomCodeInput.trim(), nickname.trim());
  };

  const handlePlayOffline = () => {
    audioSystem.init();
    audioSystem.resume();
    setOfflineMode(true);
    setTimeout(() => {
        mockSocket.emit('create_room', nickname.trim() || 'Player 1');
    }, 50);
  };

  if (!gameState) {
    return (
      <div className="min-h-screen bg-[#0F0F0F] text-white font-sans flex items-center justify-center p-4 select-none relative overflow-hidden">
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <motion.div animate={{ scale: [1, 1.2, 1], x: [0, 50, 0], y: [0, -30, 0] }} transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }} className="absolute -top-[10%] -left-[10%] w-[50vw] h-[50vw] rounded-full bg-red-600/30 blur-[100px]" />
          <motion.div animate={{ scale: [1, 1.3, 1], x: [0, -50, 0], y: [0, 40, 0] }} transition={{ duration: 18, repeat: Infinity, ease: "easeInOut", delay: 2 }} className="absolute top-[50%] -right-[10%] w-[50vw] h-[50vw] rounded-full bg-blue-600/30 blur-[100px]" />
          <motion.div animate={{ scale: [1, 1.4, 1], x: [0, 30, 0], y: [0, 50, 0] }} transition={{ duration: 20, repeat: Infinity, ease: "easeInOut", delay: 5 }} className="absolute -bottom-[20%] left-[10%] w-[40vw] h-[40vw] rounded-full bg-yellow-500/20 blur-[100px]" />
          <motion.div animate={{ scale: [1, 1.2, 1], x: [0, -40, 0], y: [0, -40, 0] }} transition={{ duration: 16, repeat: Infinity, ease: "easeInOut", delay: 1 }} className="absolute top-[10%] right-[10%] w-[40vw] h-[40vw] rounded-full bg-green-500/20 blur-[100px]" />
          
          {Array.from({length: 12}).map((_, i) => (
            <motion.div
              key={i}
              initial={{ y: '120vh', x: `${Math.random() * 100}vw`, rotate: Math.random() * 360 }}
              animate={{ y: '-20vh', rotate: Math.random() * 360 + 180 }}
              transition={{ duration: 20 + Math.random() * 20, repeat: Infinity, ease: "linear", delay: Math.random() * -20 }}
              className="absolute w-24 h-36 border-[3px] border-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm"
              style={{ opacity: 0.5 }}
            >
              <div className="w-16 h-24 border-2 border-white/10 rounded-full rotate-45"></div>
              <div className="absolute top-2 left-2 w-3 h-3 rounded-full bg-white/10"></div>
              <div className="absolute bottom-2 right-2 w-3 h-3 rounded-full bg-white/10"></div>
            </motion.div>
          ))}
        </div>

        <div 
          className="w-full max-w-md bg-[#1c1c1c] border-t border-l border-white/10 rounded-[40px] p-8 relative z-10 overflow-hidden"
          style={{
            boxShadow: '0 15px 0 #0b0b0b, 0 25px 50px rgba(0,0,0,0.8), inset 0 0 15px rgba(255,255,255,0.02)'
          }}
        >
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at center, white 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
          
          <div className="relative z-10">
            <div className="flex justify-center mb-8">
              <div 
                className="bg-red-600 px-6 py-2 rounded-xl border-t-2 border-l-2 border-white font-black italic text-4xl transform -rotate-6 tracking-tighter"
                style={{
                  boxShadow: '3px 4px 0px #991b1b, 5px 6px 10px rgba(0,0,0,0.5)'
                }}
              >
                UNO+
              </div>
            </div>
            
            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-6 bg-red-600/20 border border-red-500/50 text-red-400 p-3 rounded-xl flex items-center gap-2 text-sm font-bold tracking-wider">
                  <AlertCircle size={18} /> {error}
                </motion.div>
              )}
            </AnimatePresence>
 
            <form className="space-y-6">
              <div>
                <label className="block text-[10px] uppercase tracking-[0.2em] text-white/50 mb-2 font-bold pl-2">Choose Nickname</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. Player 1"
                  maxLength={15}
                  className="w-full bg-white/5 border border-white/10 focus:border-white focus:ring-1 focus:ring-white rounded-2xl px-4 py-4 text-white placeholder-white/30 outline-none transition-all font-bold"
                />
              </div>
 
              <div className="grid grid-cols-2 gap-4 pt-4 mt-2">
                <button
                  onClick={handleCreateRoom}
                  type="button"
                  className="bg-blue-600 hover:bg-blue-500 border-t border-l border-white/20 text-white font-black italic tracking-widest py-4 px-4 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all active:translate-y-[4px] active:shadow-[0_2px_0_#1d4ed8]"
                  style={{
                    boxShadow: '0 6px 0 #1d4ed8, 0 10px 15px rgba(0,0,0,0.5)'
                  }}
                >
                  <Users size={20} className="mb-1" /> CREATE
                </button>
                <div className="space-y-3 flex flex-col">
                  <input
                    type="text"
                    value={roomCodeInput}
                    onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                    placeholder="ROOM"
                    maxLength={6}
                    className="w-full bg-white/5 border border-white/10 focus:border-white focus:ring-1 focus:ring-white rounded-2xl px-4 py-3 text-white placeholder-white/30 outline-none transition-all uppercase text-center font-mono tracking-widest font-bold"
                  />
                  <button
                    onClick={handleJoinRoom}
                    type="button"
                    className="w-full bg-white/10 hover:bg-white/20 border-t border-l border-white/10 text-white font-black italic tracking-widest py-3 px-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:translate-y-[3px] active:shadow-[0_1px_0_#111]"
                    style={{
                      boxShadow: '0 4px 0 #111, 0 8px 12px rgba(0,0,0,0.4)'
                    }}
                  >
                    JOIN
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (gameState.status === 'lobby') {
    const isHost = gameState.players[0]?.id === activeSocket.id;

    return (
      <div className="min-h-screen bg-[#0F0F0F] text-white font-sans p-4 md:p-8 flex flex-col items-center select-none relative">
         <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at center, white 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
         
         <div className="w-full max-w-4xl relative z-10 mt-10">
           <div className="flex flex-col md:flex-row justify-between items-center bg-[#1A1A1A] border border-white/10 rounded-[40px] p-8 mb-8 shadow-2xl gap-8">
              <div className="text-center md:text-left">
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-white/50 font-bold mb-2">Room Code</h2>
                <div className="flex items-center justify-center md:justify-start gap-4">
                  <span className="text-5xl font-mono font-black tracking-[0.2em] text-yellow-400 drop-shadow-md">{gameState.roomCode}</span>
                  <button onClick={copyRoomCode} className="p-3 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 transition-colors text-white/80 hover:text-white mt-1" title="Copy code">
                    {copied ? <Check size={24} className="text-green-400" /> : <Copy size={24} />}
                  </button>
                </div>
              </div>
              <div className="w-full md:w-auto mt-6 md:mt-0">
                {isHost ? (
                  <div className="flex flex-col gap-4 items-center md:items-end w-full">
                    <div className="flex flex-wrap justify-center md:justify-end gap-2 w-full shrink-0">
                      <button onClick={() => activeSocket.emit('add_bot', 1)} className="bg-purple-600 hover:bg-purple-500 text-white font-black py-2 px-4 rounded-full border-2 border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all text-xs uppercase transform active:scale-95">+1 BOT</button>
                      <button onClick={() => activeSocket.emit('add_bot', 4)} className="bg-purple-600 hover:bg-purple-500 text-white font-black py-2 px-4 rounded-full border-2 border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all text-xs uppercase transform active:scale-95">+4 BOTS</button>
                      <button onClick={() => activeSocket.emit('add_bot', 6)} className="bg-purple-600 hover:bg-purple-500 text-white font-black py-2 px-4 rounded-full border-2 border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all text-xs uppercase transform active:scale-95">+6 BOTS</button>
                      <button onClick={() => activeSocket.emit('add_bot', 8)} className="bg-purple-600 hover:bg-purple-500 text-white font-black py-2 px-4 rounded-full border-2 border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all text-xs uppercase transform active:scale-95">+8 BOTS</button>
                    </div>
                    <button
                      onClick={() => activeSocket.emit('start_game')}
                      className="bg-green-500 hover:bg-green-400 text-black border-t border-l border-white/20 font-black italic text-xl tracking-widest py-4 px-12 w-full md:w-auto rounded-full flex items-center justify-center transition-all active:translate-y-[4px] active:shadow-[0_2px_0_#15803d] mt-2"
                      style={{
                        boxShadow: '0 6px 0 #15803d, 0 10px 15px rgba(0,0,0,0.3)'
                      }}
                    >
                      START GAME
                    </button>
                  </div>
                ) : (
                  <div className="text-white/40 font-bold uppercase tracking-widest text-sm text-center border border-white/10 px-8 py-4 rounded-full bg-white/5">
                    Waiting for host...
                  </div>
                )}
              </div>
           </div>
 
           <div className="bg-[#1A1A1A] border border-white/10 rounded-[40px] p-8 shadow-2xl">
              <div className="flex justify-between items-end border-b border-white/10 pb-4 mb-6">
                <h3 className="text-xl font-black italic tracking-widest uppercase">Players</h3>
                <span className="text-sm font-bold text-white/50 tracking-widest">{gameState.players.length} / 20</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {gameState.players.map((p, idx) => {
                  const avatarColors = ['bg-blue-600', 'bg-red-600', 'bg-yellow-500 text-black', 'bg-green-500', 'bg-purple-600', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500', 'bg-indigo-600'];
                  const avatarColor = avatarColors[idx % avatarColors.length];
                  return (
                    <div 
                      key={p.id} 
                      className="bg-[#242424] border-t border-l border-white/10 rounded-2xl p-4 flex flex-col items-center gap-3 relative hover:scale-105 transition-all duration-300"
                      style={{
                        boxShadow: '0 4px 0 #121212, 0 8px 12px rgba(0,0,0,0.5), inset 0 0 10px rgba(0,0,0,0.2)'
                      }}
                    >
                      {idx === 0 && <span className="absolute top-2 right-2 text-[8px] uppercase font-black tracking-widest text-yellow-400 bg-yellow-400/20 px-2 py-0.5 rounded shadow-sm">Host</span>}
                      {p.isBot && <span className="absolute top-2 left-2 text-[8px] uppercase font-black tracking-widest text-purple-400 bg-purple-400/20 px-2 py-0.5 rounded shadow-sm">BOT</span>}
                      <div className={`w-14 h-14 rounded-full flex items-center justify-center font-black text-xl border-4 border-white/20 shadow-lg ${avatarColor}`}>
                        {p.nickname.substring(0, 2).toUpperCase()}
                      </div>
                      <span className="font-bold text-sm truncate w-full text-center tracking-wider">
                        {p.nickname} {p.id === activeSocket.id && <span className="text-white/40 ml-1">(You)</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (gameState.status === 'playing') {
    const isMyTurn = gameState.players[gameState.currentPlayerIndex]?.id === activeSocket.id;
    const me = gameState.players.find(p => p.id === activeSocket.id);
    
    const sortedHand = [...myHand].sort((a, b) => {
      if (a.color !== b.color) {
        if (a.color === 'Wild') return 1;
        if (b.color === 'Wild') return -1;
        return a.color.localeCompare(b.color);
      }
      return a.value.localeCompare(b.value);
    });

    const getCardColors = (color: CardColor) => {
      switch (color) {
        case 'Red': return 'bg-[#E32126]';
        case 'Blue': return 'bg-[#0070B9]';
        case 'Green': return 'bg-[#3AA844]';
        case 'Yellow': return 'bg-[#FCD800]';
        case 'Wild': return 'bg-neutral-900';
        default: return 'bg-gray-500';
      }
    };

    const colorHexMap: Record<string, string> = {
      Red: '#E32126', Blue: '#0070B9', Green: '#3AA844', Yellow: '#FCD800', Wild: '#111'
    };
    
    const renderCard = (card: Card | null, onClick?: () => void, isPlayable?: boolean, customDims?: string) => {
      const dims = customDims || "w-16 h-24 md:w-[90px] md:h-[135px]";

      if (!card) return (
         <div 
           className={`${dims} shrink-0 bg-[#7f1d1d] rounded-[8px] md:rounded-[12px] border-[3px] md:border-[5px] border-white flex flex-col items-center justify-center relative overflow-hidden`} 
           style={{ 
             transformStyle: 'preserve-3d', 
             perspective: '1000px', 
             boxShadow: '0 1px 0 #bbb, 0 2px 0 #aaa, 0 3px 0 #999, 0 5px 8px rgba(0,0,0,0.6), inset 0 0 15px rgba(0,0,0,0.4)' 
           }}
         >
            {/* Card back pattern */}
            <div className="absolute inset-1 border border-yellow-500/20 rounded-lg pointer-events-none"></div>
            <div className="w-[85%] h-[65%] rounded-[50%] bg-red-600 flex items-center justify-center border-2 md:border-4 border-yellow-500 shadow-xl rotate-[-20deg] relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10 pointer-events-none"></div>
              <div className="text-xl md:text-3xl font-black italic text-white drop-shadow-[2px_3px_0px_rgba(0,0,0,0.5)] tracking-tighter rotate-[20deg]">UNO</div>
            </div>
            {/* Gloss sheen */}
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-white/5 pointer-events-none z-10"></div>
         </div>
      );
      
      const isWild = card.color === 'Wild';
      const dispVal = card.value === 'Reverse' ? '⟲' : card.value === 'Skip' ? '⊘' : card.value === 'Draw2' ? '+2' : card.value === 'WildDraw4' ? '+4' : card.value;

      return (
        <motion.div
           layoutId={`card-${card.id}`}
           initial={{ opacity: 0, scale: 0.8 }}
           animate={{ opacity: 1, scale: 1 }}
           whileHover={onClick && isPlayable ? { 
             scale: 1.12, 
             y: -25, 
             rotateX: 20, 
             rotateY: 10, 
             rotateZ: -2,
             zIndex: 100,
             transition: { type: 'spring', stiffness: 300, damping: 18 }
           } : {}}
           onClick={onClick && isPlayable ? onClick : undefined}
           className={`${dims} shrink-0 cursor-${onClick && isPlayable ? 'pointer' : 'default'} rounded-[8px] md:rounded-[12px] border-[3px] md:border-[5px] border-white relative overflow-hidden flex flex-col items-center justify-center ${getCardColors(card.color)} ${!isPlayable && onClick ? 'opacity-60 brightness-40 cursor-not-allowed filter transform-none' : ''}`}
           style={{ 
             transformStyle: 'preserve-3d', 
             perspective: '1000px', 
             boxShadow: onClick && isPlayable 
               ? '0 1px 0 #ddd, 0 2px 0 #ccc, 0 3px 0 #bbb, 0 4px 0 #aaa, 0 6px 10px rgba(0,0,0,0.4), inset 0 0 12px rgba(0,0,0,0.2)' 
               : '0 1px 0 #bbb, 0 2px 0 #aaa, 0 3px 0 #999, 0 4px 6px rgba(0,0,0,0.5), inset 0 0 10px rgba(0,0,0,0.25)'
           }}
        >
          {/* Card gloss sheen overlay */}
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-white/5 pointer-events-none z-10 mix-blend-overlay"></div>
          
          {isWild ? (
             <>
               <div className="absolute top-1 left-1.5 md:top-1 md:left-2 flex flex-col gap-[2px]">
                 <span className="text-xs md:text-[18px] font-black drop-shadow-sm rotate-[-15deg]" style={{WebkitTextStroke: '1px black', color: 'white'}}>W</span>
               </div>
               <div className="absolute bottom-1 right-1.5 md:bottom-1 md:right-2 flex flex-col gap-[2px] rotate-180">
                 <span className="text-xs md:text-[18px] font-black drop-shadow-sm rotate-[-15deg]" style={{WebkitTextStroke: '1px black', color: 'white'}}>W</span>
               </div>
             </>
          ) : (
             <>
               <div className="absolute top-1 left-1.5 md:top-1.5 md:left-2 text-xs md:text-xl font-black drop-shadow-md" style={{WebkitTextStroke: '1px black', color: 'white'}}>{dispVal}</div>
               <div className="absolute bottom-1 right-1.5 md:bottom-1.5 md:right-2 text-xs md:text-xl font-black rotate-180 drop-shadow-md" style={{WebkitTextStroke: '1px black', color: 'white'}}>{dispVal}</div>
             </>
          )}

          <div className="w-[82%] h-[62%] rounded-[50%] bg-white flex items-center justify-center shadow-[inset_0_2px_5px_rgba(0,0,0,0.4)] rotate-[-20deg] border border-black/10 relative overflow-hidden" style={{ transform: 'rotate(-20deg) translateZ(10px)' }}>
            {isWild ? (
               <div className="w-[92%] h-[92%] rounded-[50%] overflow-hidden flex flex-wrap border-[2px] border-white">
                 <div className="w-1/2 h-1/2 bg-[#E32126]"></div>
                 <div className="w-1/2 h-1/2 bg-[#0070B9]"></div>
                 <div className="w-1/2 h-1/2 bg-[#FCD800]"></div>
                 <div className="w-1/2 h-1/2 bg-[#3AA844]"></div>
               </div>
            ) : (
               <div className="rotate-[20deg] text-[#1F2937] flex items-center justify-center">
                 <span className="text-3xl md:text-[48px] font-black italic drop-shadow-[1px_2px_0px_rgba(0,0,0,0.15)] leading-none">{dispVal}</span>
               </div>
            )}
          </div>
          
          {isPlayable && (
             <div className="absolute top-[50%] left-1/2 -translate-x-1/2 -translate-y-1/2 bg-yellow-400 text-black px-1.5 py-[1px] md:px-2 md:py-[2px] rounded text-[7px] md:text-[9px] font-black italic tracking-widest shadow-2xl whitespace-nowrap hidden md:block border border-black z-20" style={{ transform: 'translate(-50%, -50%) translateZ(20px) rotate(-10deg)' }}>PLAYABLE</div>
          )}
        </motion.div>
      );
    };

    const checkPlayable = (card: Card) => {
      if (!isMyTurn || gameState.specialAction.type !== 'none') return false;
      if (card.color === 'Wild') return true;
      if (gameState.currentColor === card.color) return true;
      if (gameState.topCard && gameState.topCard.value === card.value) return true;
      return false;
    };

    const avatarColors = ['bg-blue-500', 'bg-red-500', 'bg-yellow-500 text-black', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500', 'bg-indigo-500'];
    const getAvatarColor = (idx: number) => avatarColors[idx % avatarColors.length];

    return (
      <div className="h-screen bg-[#0F0F0F] text-white font-sans flex flex-col overflow-hidden select-none relative">
         <header className="h-16 border-b border-white/10 flex items-center justify-between px-4 md:px-8 bg-[#151515] shrink-0 z-20">
           <div className="flex items-center gap-4 md:gap-6">
             <div className="bg-red-600 px-3 py-1 rounded font-black italic text-lg md:text-xl tracking-tighter shadow-md">UNO+</div>
             <div className="h-6 w-[1px] bg-white/20 hidden sm:block"></div>
             <div className="flex flex-col">
               <span className="text-[8px] md:text-[10px] uppercase tracking-widest text-white/40">Room Code</span>
               <span className="text-xs md:text-sm font-mono font-bold tracking-widest text-yellow-400">{gameState.roomCode}</span>
             </div>
           </div>
           <div className="flex items-center gap-4 md:gap-8">
             <AnimatePresence>
               {error && (
                 <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="hidden lg:flex text-red-500 font-bold text-xs items-center gap-1 bg-red-500/10 px-3 py-1 rounded-full border border-red-500/20">
                   <AlertCircle size={14} /> {error}
                 </motion.div>
               )}
             </AnimatePresence>
             <div className="flex gap-4">
               <div className="flex flex-col items-end hidden sm:flex">
                  <span className="text-[8px] md:text-[10px] uppercase tracking-widest text-white/40">Status</span>
                  <span className="text-[10px] md:text-xs font-bold text-green-400">ACTIVE GAME</span>
               </div>
               <div className="flex flex-col items-end">
                  <span className="text-[8px] md:text-[10px] uppercase tracking-widest text-white/40">Players</span>
                  <span className="text-[10px] md:text-xs font-bold">{gameState.players.length} / 20</span>
               </div>
             </div>
           </div>
         </header>

         {/* Opponents Area */}
         <div className="absolute top-16 left-0 right-0 z-10 pt-4 px-4 pb-2 bg-gradient-to-b from-[#0F0F0F] to-transparent">
           <div className="flex gap-2 md:gap-4 overflow-x-auto no-scrollbar justify-start md:justify-center px-4 snap-x">
             {gameState.players.map((p, idx) => {
               const isCurrent = idx === gameState.currentPlayerIndex;
               if (p.id === activeSocket.id) return null;
               return (
                 <div key={p.id} className={`relative flex flex-col items-center justify-center gap-1.5 md:gap-2 shrink-0 border border-white/5 rounded-xl bg-white/5 p-2 px-3 md:px-4 transition-all duration-300 ${isCurrent ? 'ring-2 ring-green-500 scale-105 shadow-xl bg-white/10' : 'opacity-90'}`}>
                   {p.isBot && <span className="absolute -top-1 left-1 text-[7px] uppercase font-black tracking-widest text-[#0F0F0F] bg-purple-400 border border-white/10 px-1 py-[1px] rounded-sm shadow-sm z-10">BOT</span>}
                   <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center font-bold border-2 border-white/20 text-sm md:text-base shadow-lg ${getAvatarColor(idx)}`}>
                     {p.nickname.substring(0, 2).toUpperCase()}
                   </div>
                   <div className="text-center w-full">
                     <p className="text-[10px] md:text-xs font-bold truncate max-w-[50px] md:max-w-[70px]">{p.nickname}</p>
                     <p className={`text-[8px] md:text-[10px] ${p.hasUNO ? 'text-red-500' : 'text-white/40'} uppercase font-black tracking-wider`}>
                       {p.hasUNO ? 'UNO!' : `${p.handCount} Cards`}
                     </p>
                   </div>
                 </div>
               );
             })}
           </div>
         </div>

          {/* Central Play Area */}
          <div className="flex-grow min-h-0 relative flex flex-col items-center justify-center px-4 md:px-8 mt-24 mb-4">
             {/* Outer Table Rim (Wooden Bezel) */}
             <div 
               className="w-full max-w-4xl h-full min-h-[350px] md:min-h-[400px] bg-[#2E1A0F] rounded-[45px] p-[10px] md:p-[14px] shadow-[0_35px_70px_rgba(0,0,0,0.9),inset_0_4px_10px_rgba(255,255,255,0.25)] border-b-[12px] border-r-[12px] border-black/50 relative z-10 flex items-center justify-center overflow-visible" 
               style={{ transformStyle: 'preserve-3d', perspective: '1200px', transform: 'rotateX(18deg) rotateY(-2deg)' }}
             >
               {/* Inner Felt Surface */}
               <div className="w-full h-full bg-gradient-to-b from-[#0F5A3E] to-[#093D28] rounded-[35px] border-2 border-black/40 flex flex-col md:flex-row items-center justify-center relative overflow-visible shadow-[inset_0_12px_30px_rgba(0,0,0,0.85)] p-8">
                 {/* Felt Texture Pattern */}
                 <div className="absolute inset-0 opacity-[0.03] pointer-events-none rounded-[35px] overflow-hidden" style={{ backgroundImage: 'radial-gradient(circle at center, white 1px, transparent 1px)', backgroundSize: '16px 16px' }}></div>
                 {/* Felt Golden Inner Ring */}
                 <div className="absolute inset-4 border border-yellow-600/15 rounded-[28px] pointer-events-none"></div>

                 <AnimatePresence>
                  {isDealing && (
                    <motion.div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center">
                      {Array.from({ length: Math.min(gameState.players.length * 7, 28) }).map((_, i) => {
                        const pIdx = i % gameState.players.length;
                        const pId = gameState.players[pIdx].id;
                        const isMe = pId === activeSocket.id;
                        const targetX = isMe ? 0 : (pIdx - gameState.players.length/2)*50;
                        return (
                            <motion.div
                              key={i}
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: [0, 1.2, 0.5], x: [0, targetX/2, targetX], y: [0, (isMe ? 200 : -200), (isMe ? window.innerHeight/2 + 200 : -window.innerHeight/2 - 200)], rotate: 360, opacity: [0, 1, 0] }}
                              transition={{ duration: 0.8, delay: i * 0.05, ease: "easeInOut" }}
                              className="absolute w-16 h-24 md:w-[90px] md:h-[135px] bg-[#7f1d1d] rounded-[8px] md:rounded-[12px] border-[3px] border-white flex items-center justify-center shadow-2xl"
                            >
                               <div className="absolute inset-1 border border-yellow-500/20 rounded-lg pointer-events-none"></div>
                               <div className="text-xl md:text-2xl font-black italic text-white/40 rotate-45 drop-shadow-md">UNO</div>
                            </motion.div>
                        );
                      })}
                    </motion.div>
                  )}
                 </AnimatePresence>
                 
                 {/* Funny Text Popup Overlay */}
                <AnimatePresence>
                  {funnyText && (
                    <motion.div
                      key={funnyText.id}
                      initial={{ opacity: 0, scale: 0.5, y: 50, rotate: -5 }}
                      animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
                      exit={{ opacity: 0, scale: 0.8, y: -50, filter: 'blur(10px)' }}
                      transition={{ type: "spring", bounce: 0.6 }}
                      className="absolute z-50 pointer-events-none"
                      style={{ top: '15%', transform: 'translateZ(60px)' }}
                    >
                      <div className="bg-yellow-400 text-black border-4 border-black font-black text-xl md:text-3xl italic px-8 py-4 rounded-3xl shadow-[5px_5px_0_0_#000] rotate-[-5deg]">
                        {funnyText.text}
                      </div>
                    </motion.div>
                  )}
                  {delayedText && (
                    <motion.div
                      key={delayedText.id}
                      initial={{ opacity: 0, scale: 0.5, y: -50, rotate: 5 }}
                      animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
                      exit={{ opacity: 0, scale: 0.8, y: 50, filter: 'blur(10px)' }}
                      transition={{ type: "spring", bounce: 0.6 }}
                      className="absolute z-45 pointer-events-none"
                      style={{ top: '25%', transform: 'translateZ(70px)' }}
                    >
                      <div className="bg-red-500 text-white border-4 border-white font-black text-lg md:text-2xl italic px-8 py-4 rounded-3xl shadow-[5px_5px_0_0_#fff] rotate-[3deg]">
                        {delayedText.text}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                
                <div className="flex items-center gap-8 md:gap-16 z-10 scale-95 md:scale-100 mt-4 md:mt-0" style={{ transform: 'translateZ(15px)', transformStyle: 'preserve-3d' }}>
                  {/* Draw Pile Deck Stack */}
                  <div className="relative group cursor-pointer" style={{ transformStyle: 'preserve-3d' }} onClick={() => { if(isMyTurn && gameState.specialAction.type === 'none') activeSocket.emit('draw_card') }}>
                    {/* Background card stacks to simulate height/depth */}
                    <div className="w-[64px] h-[96px] md:w-[90px] md:h-[135px] bg-[#5a1414] rounded-[8px] md:rounded-[12px] border-[2px] md:border-[4px] border-white/60 absolute top-[4px] left-[4px] rotate-[-2deg] opacity-40 shadow-md pointer-events-none" style={{ transform: 'translateZ(2px)' }}></div>
                    <div className="w-[64px] h-[96px] md:w-[90px] md:h-[135px] bg-[#6b1818] rounded-[8px] md:rounded-[12px] border-[2px] md:border-[4px] border-white/80 absolute top-[2px] left-[2px] rotate-[1deg] opacity-70 shadow-lg pointer-events-none" style={{ transform: 'translateZ(4px)' }}></div>
                    
                    {/* Top card of the stack */}
                    <div 
                      className={`w-[64px] h-[96px] md:w-[90px] md:h-[135px] bg-[#7f1d1d] rounded-[8px] md:rounded-[12px] border-[3px] md:border-[5px] border-white flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300 ${isMyTurn && gameState.specialAction.type === 'none' ? 'group-hover:-translate-y-2 group-hover:shadow-[0_15px_30px_rgba(0,0,0,0.6)] group-hover:border-yellow-400' : ''}`}
                      style={{ 
                        transform: 'translateZ(6px)', 
                        boxShadow: '0 1px 0 #ccc, 0 2px 0 #bbb, 0 3px 0 #aaa, 0 5px 8px rgba(0,0,0,0.55), inset 0 0 15px rgba(0,0,0,0.4)',
                        transformStyle: 'preserve-3d'
                      }}
                    >
                      <div className="absolute inset-1 border border-yellow-500/20 rounded-lg pointer-events-none"></div>
                      <div className="w-[85%] h-[65%] rounded-[50%] bg-red-600 flex items-center justify-center border-2 md:border-4 border-yellow-500 shadow-inner rotate-[-20deg]">
                        <div className="text-xs md:text-2xl font-black italic text-white drop-shadow-md tracking-tighter rotate-[20deg]">UNO</div>
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10 pointer-events-none z-10"></div>
                      {isMyTurn && gameState.specialAction.type === 'none' && (
                         <div className="absolute top-[50%] left-1/2 -translate-x-1/2 -translate-y-1/2 bg-green-500 text-white px-1.5 py-[2px] rounded text-[6px] md:text-[8px] font-black italic tracking-widest shadow-lg pointer-events-none border border-black z-20" style={{ transform: 'translate(-50%, -50%) translateZ(10px) rotate(-5deg)' }}>DRAW</div>
                      )}
                    </div>
                  </div>

                  {/* Discard Pile Stack */}
                  <div className="relative w-[64px] h-[96px] md:w-[90px] md:h-[135px] shrink-0" style={{ transformStyle: 'preserve-3d' }}>
                    {discardPileUI.map((c, i) => (
                      <motion.div
                        key={c.key}
                        initial={{ scale: 1.5, rotateY: 180, opacity: 0, y: -200 }}
                        animate={{ scale: 1, rotateY: 0, rotateZ: c.rotate, x: c.x, y: c.y, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 200, damping: 20 }}
                        className="absolute inset-0 z-10"
                        style={{ 
                          zIndex: i + 10,
                          transform: `translateZ(${i * 1.5}px)` // Stack height in 3D space
                        }}
                      >
                        {renderCard(c, undefined, undefined, "w-[64px] h-[96px] md:w-[90px] md:h-[135px]")}
                      </motion.div>
                    ))}
                    
                    {/* Active Color Indicator */}
                    {gameState.currentColor && (
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -right-8 md:-right-14 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-50 pointer-events-none" style={{ transform: 'translateZ(40px)' }}>
                        <div className="text-[7px] md:text-[9px] uppercase font-black tracking-widest text-white/70 drop-shadow-md">COLOR</div>
                        <div className="w-6 h-6 md:w-8 md:h-8 rounded-full border-2 md:border-[3px] border-white shadow-2xl" style={{ backgroundColor: colorHexMap[gameState.currentColor] }} />
                      </motion.div>
                    )}
                  </div>
                </div>

                <div className="absolute bottom-4 flex items-center gap-3 px-5 py-1.5 bg-black/60 backdrop-blur rounded-full border border-white/10 z-10" style={{ transform: 'translateZ(10px)' }}>
                   <span className="text-[7px] md:text-[9px] uppercase tracking-[0.2em] text-white/60 font-bold hidden sm:block">Direction</span>
                   <span className="text-[9px] font-black text-white px-2 py-0.5 rounded bg-white/10">{gameState.direction === 1 ? 'CLOCKWISE' : 'COUNTER'}</span>
                   <div className={`text-green-400 font-bold text-xs md:text-sm ${gameState.direction === -1 ? 'scale-x-[-1]' : ''}`}>↻</div>
                </div>

                <AnimatePresence>
                  {gameState.specialAction.type === 'choosing_color' && isMyTurn && (
                    <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="absolute z-30 inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-hidden rounded-[30px]" style={{ transform: 'translateZ(30px)' }}>
                      <div className="bg-[#151515] border border-white/20 p-6 md:p-8 rounded-[30px] shadow-2xl shrink-0 flex flex-col items-center">
                        <h3 className="text-lg md:text-xl font-black italic uppercase tracking-widest mb-6 text-center drop-shadow-md">Select Color</h3>
                        <div className="grid grid-cols-2 gap-4">
                          {(['Red', 'Blue', 'Green', 'Yellow'] as const).map(c => (
                            <button
                              key={c}
                              onClick={() => activeSocket.emit('choose_color', c)}
                              className={`w-16 h-16 md:w-24 md:h-24 rounded-2xl border-[4px] md:border-[6px] shadow-2xl relative overflow-hidden group active:scale-95 transition-all
                                ${c === 'Red' ? 'bg-red-600 border-red-400 hover:border-white' : 
                                  c === 'Blue' ? 'bg-blue-600 border-blue-400 hover:border-white' : 
                                  c === 'Green' ? 'bg-green-500 border-green-300 hover:border-white' : 
                                  'bg-yellow-500 border-yellow-300 hover:border-white text-black'}`}
                            >
                              <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-20 transition-opacity"></div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
               </div>
             </div>
           </div>

         {/* Bottom Action Area / Hand */}
         <div className="h-44 md:h-56 shrink-0 bg-black/60 border-t border-white/10 relative z-10 flex flex-col">
            <div className="absolute -top-14 md:-top-16 right-4 md:right-8 flex gap-3 md:gap-4 z-20">
               {me?.handCount === 1 || me?.handCount === 2 ? (
                 <button
                   onClick={() => activeSocket.emit('call_uno')}
                   className="bg-red-600 hover:bg-red-500 text-white px-6 py-3 md:px-10 md:py-4 rounded-full font-black italic tracking-[0.2em] md:tracking-[0.3em] text-sm md:text-xl shadow-[0_0_20px_rgba(220,38,38,0.5)] border-2 border-white transform active:scale-95 transition-all"
                 >
                   UNO!
                 </button>
               ) : null}
            </div>

            <div className="flex-grow pt-4 md:pt-6 pb-2 px-2 flex justify-center w-full">
              <div className="w-full max-w-5xl flex gap-1 md:gap-2 px-4 md:px-12 overflow-x-auto no-scrollbar items-end h-full snap-x pb-4">
                 <div className="flex items-end gap-[-15px] md:gap-[-25px] justify-center min-w-min mx-auto mr-12 md:mr-16">
                   <AnimatePresence mode="popLayout">
                     {sortedHand.map((card, idx) => {
                       const playable = checkPlayable(card);
                       const offset = (idx - (sortedHand.length - 1) / 2);
                       const rotation = offset * 5; // slight fanning 
                       const yOffset = Math.abs(offset) * 3;
                       
                       return (
                         <motion.div 
                           key={card.id} 
                           layout 
                           layoutId={`my-card-${card.id}`}
                           initial={{ opacity: 0, y: 50, scale: 0.8 }}
                           animate={{ opacity: 1, y: yOffset, rotate: rotation, scale: 1 }}
                           exit={{ opacity: 0, scale: 0.5, y: -100, rotate: (Math.random()-0.5)*100 }}
                           transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                           className={`origin-bottom -mr-8 md:-mr-12 shrink-0 hover:z-50 hover:!rotate-0 group`}
                           style={{ zIndex: 10 + idx }}
                         >
                           {renderCard(card, () => {
                              if (playable) activeSocket.emit('play_card', card.id);
                           }, playable)}
                         </motion.div>
                       );
                     })}
                   </AnimatePresence>
                </div>
              </div>
            </div>
            
            {/* Status indicator absolute positioned at bottom left */}
            <div className="absolute top-2 left-6 xs:top-auto xs:bottom-4 xs:left-6 flex items-center gap-3">
              <div className="flex bg-[#151515] rounded-full p-1 border border-white/10 items-center pr-4 shadow-lg">
                 <div className={`w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center ${isMyTurn ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)] animate-pulse' : 'bg-white/10'} mr-3 border border-white/20`} />
                 <span className={`text-[10px] md:text-sm font-black uppercase tracking-widest ${isMyTurn ? 'text-white' : 'text-white/40'}`}>
                   {isMyTurn ? 'YOUR TURN' : 'WAITING'}
                 </span>
              </div>
            </div>
         </div>
         
         <style>{`
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
         `}</style>
      </div>
    );
  }

  // --- FINISHED STATE ---
  if (gameState.status === 'finished') {
    return (
      <div className="min-h-screen bg-[#0F0F0F] text-white font-sans flex flex-col items-center justify-center p-8 text-center relative overflow-hidden select-none">
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at center, white 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-yellow-500/20 rounded-full blur-[100px] pointer-events-none" />
        
        <div className="relative z-10 bg-[#1A1A1A] border border-white/10 p-12 rounded-[40px] shadow-2xl flex flex-col items-center">
          <h1 className="text-6xl md:text-8xl font-black mb-8 pt-4 pb-2 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600 uppercase italic tracking-tighter drop-shadow-lg">
             GAME OVER
          </h1>
          <div className="flex flex-col items-center gap-2 mb-12">
            <span className="text-[10px] uppercase font-bold tracking-[0.3em] text-white/50">Winner</span>
            <span className="text-4xl font-bold font-mono tracking-wider">{gameState.winner?.nickname || 'Unknown'}</span>
          </div>
          
          <button
             onClick={() => window.location.reload()}
             className="bg-white hover:bg-neutral-200 text-black font-black italic uppercase tracking-widest text-xl py-4 px-12 rounded-full shadow-[0_0_20px_rgba(255,255,255,0.3)] transition-transform active:scale-95"
          >
             VIEW LOBBY
          </button>
        </div>
      </div>
    );
  }

  return null;
}

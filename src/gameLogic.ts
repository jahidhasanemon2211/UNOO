import { Card, CardColor, CardValue, GameState, PlayerState, SpecialActionState } from './types';

// In-memory store
export const rooms = new Map<string, RoomLogic>();

const COLORS: CardColor[] = ['Red', 'Blue', 'Green', 'Yellow'];
const VALUES: CardValue[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', 'Draw2'];

function generateDeck(multiplier: number = 2): Card[] {
  let deck: Card[] = [];
  let idCounter = 0;

  for (let m = 0; m < multiplier; m++) {
    // Colors
    for (const color of COLORS) {
      deck.push({ id: `c_${idCounter++}`, color, value: '0' });
      for (const value of VALUES) {
        if (value !== '0') {
          deck.push({ id: `c_${idCounter++}`, color, value });
          deck.push({ id: `c_${idCounter++}`, color, value }); // Two of each 1-9 and action cards
        }
      }
    }
    // Wilds
    for (let i = 0; i < 4; i++) {
      deck.push({ id: `c_${idCounter++}`, color: 'Wild', value: 'Wild' });
      deck.push({ id: `c_${idCounter++}`, color: 'Wild', value: 'WildDraw4' });
    }
  }

  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

export class RoomLogic {
  roomCode: string;
  players: PlayerState[] = [];
  deck: Card[] = [];
  discardPile: Card[] = [];
  currentPlayerIndex: number = 0;
  direction: 1 | -1 = 1;
  status: 'lobby' | 'playing' | 'finished' = 'lobby';
  winner: string | null = null;
  specialAction: SpecialActionState = { type: 'none' };
  currentColor: CardColor | null = null;
  
  hostId: string | null = null;
  botTimer: NodeJS.Timeout | null = null;
  onStateUpdate: () => void = () => {};
  onAction: (playerId: string, actionType: string, cardValue?: string) => void = () => {};

  constructor(roomCode: string) {
    this.roomCode = roomCode;
  }

  addPlayer(id: string, nickname: string, isBot: boolean = false) {
    if (this.status !== 'lobby') {
      throw new Error('Game already in progress');
    }
    if (this.players.length === 0 && !isBot) {
      this.hostId = id;
    }
    this.players.push({
      id,
      nickname,
      hand: [],
      isReady: false,
      hasUNO: false,
      isBot,
    });
  }

  addBot() {
    if (this.status !== 'lobby') {
      throw new Error('Game already in progress');
    }
    const bgNames = ['Bot Alpha', 'Bot Beta', 'Bot Gamma', 'Bot Delta', 'Bot Echo', 'Bot Zeta'];
    const nm = bgNames[Math.floor(Math.random() * bgNames.length)] + '-' + Math.floor(Math.random() * 1000);
    this.addPlayer(`bot_${Math.random().toString(36).substr(2, 6)}`, nm, true);
  }

  removePlayer(id: string) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx !== -1) {
      // Return cards to deck
      this.deck.push(...this.players[idx].hand);
      this.players.splice(idx, 1);

      if (this.status === 'playing') {
        if (this.players.length < 2) {
          this.status = 'finished';
          if (this.players.length === 1) {
            this.winner = this.players[0].id;
          }
        } else {
          // Adjust current player index
          if (this.currentPlayerIndex >= this.players.length) {
            this.currentPlayerIndex = 0;
          }
        }
      } else if (this.players.length > 0 && id === this.hostId) {
        this.hostId = this.players[0].id;
      }
    }
  }

  startGame(playerId: string) {
    if (playerId !== this.hostId) throw new Error('Only the host can start');
    if (this.players.length < 2) throw new Error('Need at least 2 players');
    
    // Scale deck based on players. default 2 decks (216 cards), add 1 deck per 5 players
    const decksNeeded = Math.max(2, Math.ceil(this.players.length / 5));
    this.deck = generateDeck(decksNeeded);
    this.status = 'playing';

    // Deal 7 cards
    for (const player of this.players) {
      player.hand = [];
      for (let i = 0; i < 7; i++) {
        player.hand.push(this.drawOne()!);
      }
      player.hasUNO = false;
    }

    // Top card
    let top = this.drawOne()!;
    while (top.color === 'Wild') {
      this.deck.push(top);
      top = this.drawOne()!;
    }
    this.discardPile = [top];
    this.currentColor = top.color;
    
    // Apply first card effect if it's an action (Skip, Reverse, Draw2)
    // For simplicity, we just set the current color
    this.currentPlayerIndex = 0;
    this.checkBotTurn();
  }

  checkBotTurn() {
    if (this.status !== 'playing') return;
    const currentPlayer = this.players[this.currentPlayerIndex];
    if (currentPlayer && currentPlayer.isBot) {
      if (this.botTimer) clearTimeout(this.botTimer);
      this.botTimer = setTimeout(() => {
        this.executeBotMove(currentPlayer.id);
      }, 1500); // 1.5s delay
    }
  }

  executeBotMove(botId: string) {
    if (this.status !== 'playing') return;
    const playerIdx = this.players.findIndex(p => p.id === botId);
    if (playerIdx !== this.currentPlayerIndex) return;
    
    try {
      if (this.specialAction.type === 'choosing_color') {
        const colors: CardColor[] = ['Red', 'Blue', 'Green', 'Yellow'];
        const chosen = colors[Math.floor(Math.random() * colors.length)];
        this.chooseColor(botId, chosen);
        this.onStateUpdate();
        return;
      }

      const player = this.players[playerIdx];
      
      const playableCards = player.hand.filter(c => {
        if (c.color === 'Wild') return true;
        if (this.currentColor === c.color) return true;
        const top = this.discardPile[this.discardPile.length - 1];
        if (top && top.value === c.value) return true;
        return false;
      });

      if (playableCards.length > 0) {
        const cardToPlay = playableCards[Math.floor(Math.random() * playableCards.length)];
        if (player.hand.length === 2) {
          this.callUno(botId); // bot calls uno before playing last card
        }
        this.playCard(botId, cardToPlay.id);
      } else {
        this.drawCard(botId);
      }
      this.onStateUpdate();
    } catch (e) {
      console.error('Bot error', e);
    }
  }

  drawOne(): Card | null {
    if (this.deck.length === 0) {
      if (this.discardPile.length <= 1) return null; // out of cards entirely
      // reshuffle
      const top = this.discardPile.pop()!;
      this.deck = this.discardPile;
      this.discardPile = [top];
      for (let i = this.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
      }
    }
    return this.deck.pop() || null;
  }

  nextTurn() {
    this.currentPlayerIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
    this.checkBotTurn();
  }

  playCard(playerId: string, cardId: string) {
    if (this.status !== 'playing') throw new Error('Game not active');
    const playerArrayIdx = this.players.findIndex(p => p.id === playerId);
    if (playerArrayIdx !== this.currentPlayerIndex) throw new Error('Not your turn');
    if (this.specialAction.type !== 'none') throw new Error('Pending action');

    const player = this.players[playerArrayIdx];
    const cardIdx = player.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) throw new Error('Card not in hand');

    const card = player.hand[cardIdx];
    const top = this.discardPile[this.discardPile.length - 1];

    // Validate
    const isValid = card.color === 'Wild' || card.color === this.currentColor || card.value === top.value;
    if (!isValid) throw new Error('Cannot play this card');

    // Play it
    player.hand.splice(cardIdx, 1);
    this.discardPile.push(card);
    
    this.onAction(playerId, 'played_card', card.value);

    if (player.hasUNO && player.hand.length > 1) {
       player.hasUNO = false;
    }

    // Check win
    if (player.hand.length === 0) {
      this.status = 'finished';
      this.winner = player.id;
      return;
    }

    // Effect
    if (card.color === 'Wild') {
      this.specialAction = { type: 'choosing_color', pendingDraw: card.value === 'WildDraw4' ? 4 : 0 };
    } else {
      this.currentColor = card.color;
      if (card.value === 'Skip') {
        this.nextTurn();
        this.nextTurn();
      } else if (card.value === 'Reverse') {
        this.direction *= -1;
        if (this.players.length === 2) {
           this.nextTurn();
           this.nextTurn();
        } else {
           this.nextTurn();
        }
      } else if (card.value === 'Draw2') {
        this.nextTurn();
        const nextTarget = this.players[this.currentPlayerIndex];
        nextTarget.hand.push(this.drawOne()!, this.drawOne()!);
        nextTarget.hasUNO = false;
        this.nextTurn();
      } else {
        this.nextTurn();
      }
    }
  }

  chooseColor(playerId: string, color: CardColor) {
    if (this.status !== 'playing') throw new Error('Game not active');
    if (this.players.findIndex(p => p.id === playerId) !== this.currentPlayerIndex) throw new Error('Not your turn');
    if (this.specialAction.type !== 'choosing_color') throw new Error('Not choosing color');

    this.currentColor = color;
    const drawAmount = this.specialAction.pendingDraw || 0;
    this.specialAction = { type: 'none' };
    
    if (drawAmount > 0) {
      this.nextTurn();
      const target = this.players[this.currentPlayerIndex];
      for (let i = 0; i < drawAmount; i++) {
        const c = this.drawOne();
        if (c) target.hand.push(c);
      }
      target.hasUNO = false;
      this.nextTurn();
    } else {
      this.nextTurn();
    }
  }

  drawCard(playerId: string) {
    if (this.status !== 'playing') throw new Error('Game not active');
    const playerArrayIdx = this.players.findIndex(p => p.id === playerId);
    if (playerArrayIdx !== this.currentPlayerIndex) throw new Error('Not your turn');
    if (this.specialAction.type !== 'none') throw new Error('Pending action');

    const player = this.players[playerArrayIdx];
    const c = this.drawOne();
    if (c) player.hand.push(c);
    player.hasUNO = false;
    this.onAction(playerId, 'drew_card');
    this.nextTurn();
  }

  callUno(playerId: string) {
    if (this.status !== 'playing') throw new Error('Game not active');
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;
    
    if (player.hand.length === 1 || player.hand.length === 2) {
      player.hasUNO = true;
      this.onAction(playerId, 'called_uno');
    }
  }

  getStateForPlayer(playerId?: string): { state: GameState, myHand?: Card[] } {
    let winnerObj = null;
    if (this.winner) {
      const w = this.players.find(p => p.id === this.winner);
      if (w) {
        winnerObj = {
          id: w.id, nickname: w.nickname, handCount: w.hand.length, isReady: w.isReady, hasUNO: w.hasUNO
        };
      }
    }

    const state: GameState = {
      status: this.status,
      roomCode: this.roomCode,
      players: this.players.map(p => ({
        id: p.id,
        nickname: p.nickname,
        handCount: p.hand.length,
        isReady: p.isReady,
        hasUNO: p.hasUNO
      })),
      currentPlayerIndex: this.currentPlayerIndex,
      direction: this.direction,
      topCard: this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1] : null,
      currentColor: this.currentColor,
      winner: winnerObj,
      specialAction: this.specialAction
    };

    let myHand: Card[] | undefined;
    if (playerId) {
      const p = this.players.find(x => x.id === playerId);
      if (p) myHand = p.hand;
    }

    return { state, myHand };
  }
}

import { RoomLogic } from './gameLogic';
import { GameState, Card } from './types';

class MockSocket {
  private listeners: Record<string, Function[]> = {};
  private room: RoomLogic | null = null;
  public id: string = 'local_player';

  on(event: string, cb: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  off(event: string, cb?: Function) {
    if (!this.listeners[event]) return;
    if (cb) {
      this.listeners[event] = this.listeners[event].filter(l => l !== cb);
    } else {
      this.listeners[event] = [];
    }
  }

  emit(event: string, ...args: any[]) {
    setTimeout(() => this.handleEmit(event, ...args), 10);
  }

  trigger(event: string, ...args: any[]) {
    const list = this.listeners[event] || [];
    list.forEach(cb => cb(...args));
  }

  private broadcastState() {
    if (!this.room) return;
    const { state, myHand } = this.room.getStateForPlayer(this.id);
    this.trigger('game_state_update', state, myHand);
  }

  private handleEmit(event: string, ...args: any[]) {
    try {
      if (event === 'create_room') {
        const nickname = args[0] || 'Player';
        this.room = new RoomLogic('OFFLINE');
        this.room.onStateUpdate = () => this.broadcastState();
        this.room.onAction = (playerId, actionType, cardValue) => {
          this.trigger('play_animation', playerId, actionType, cardValue);
        };
        this.room.addPlayer(this.id, nickname);
        
        // Setup offline bots immediately
        this.room.addBot();
        this.room.addBot();
        this.room.addBot();
        
        this.trigger('room_created', 'OFFLINE');
        this.broadcastState();
        
        // Auto start offline game
        setTimeout(() => {
            if (this.room) {
               this.room.startGame(this.id);
               this.broadcastState();
            }
        }, 500);

      } else if (event === 'add_bot') {
        const count = args[0] || 1;
        for (let i = 0; i < count; i++) this.room?.addBot();
        this.broadcastState();

      } else if (event === 'start_game') {
        this.room?.startGame(this.id);
        this.broadcastState();

      } else if (event === 'play_card') {
        this.room?.playCard(this.id, args[0]);
        this.broadcastState();

      } else if (event === 'draw_card') {
        this.room?.drawCard(this.id);
        this.broadcastState();

      } else if (event === 'choose_color') {
        this.room?.chooseColor(this.id, args[0]);
        this.broadcastState();

      } else if (event === 'call_uno') {
        this.room?.callUno(this.id);
        this.broadcastState();
      }
    } catch (e: any) {
      this.trigger('error', e.message);
    }
  }
}

export const mockSocket = new MockSocket();

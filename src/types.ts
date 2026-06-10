export type CardColor = 'Red' | 'Blue' | 'Green' | 'Yellow' | 'Wild';
export type CardValue = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'Skip' | 'Reverse' | 'Draw2' | 'Wild' | 'WildDraw4';

export interface Card {
  id: string;
  color: CardColor;
  value: CardValue;
}

export interface Player {
  id: string; // Socket ID
  nickname: string;
  handCount: number;
  isReady: boolean;
  hasUNO: boolean;
  isBot?: boolean;
}

// For sending the player's actual hand to them
export interface PlayerState {
  id: string;
  nickname: string;
  hand: Card[];
  isReady: boolean;
  hasUNO: boolean;
  isBot?: boolean;
}

export type SpecialActionState =
  | { type: 'none' }
  | { type: 'choosing_color', pendingDraw?: number };

export interface GameState {
  status: 'lobby' | 'playing' | 'finished';
  roomCode: string;
  players: Player[];
  currentPlayerIndex: number;
  direction: 1 | -1;
  topCard: Card | null;
  currentColor: CardColor | null;
  winner: Player | null;
  specialAction: SpecialActionState;
}

// Client sends these events to Server
export interface ClientToServerEvents {
  join_room: (roomCode: string, nickname: string) => void;
  create_room: (nickname: string) => void;
  add_bot: (count?: number) => void;
  start_game: () => void;
  play_card: (cardId: string) => void;
  draw_card: () => void;
  call_uno: () => void;
  choose_color: (color: CardColor) => void;
}

// Server sends these events to Client
export interface ServerToClientEvents {
  game_state_update: (state: GameState, myHand?: Card[]) => void;
  error: (message: string) => void;
  room_created: (roomCode: string) => void;
  play_animation: (actorId: string, action: string, cardValue?: string) => void;
}

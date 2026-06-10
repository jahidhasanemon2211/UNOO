import express from 'express';
import path from 'path';
import http from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { RoomLogic, rooms } from './src/gameLogic';
import { ClientToServerEvents, ServerToClientEvents } from './src/types';

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3002;
  
  const server = http.createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, {}, {}>(server, {
    cors: { origin: '*' }
  });

  // API Route
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    let currentRoomCode: string | null = null;

    const broadcastState = (room: RoomLogic) => {
      console.log('[Server] Broadcasting state for room:', room.roomCode);
      for (const p of room.players) {
        const { state, myHand } = room.getStateForPlayer(p.id);
        console.log('[Server] Emitting game_state_update to player:', p.id, 'with hand size:', myHand?.length);
        io.to(p.id).emit('game_state_update', state, myHand);
      }
    };

    socket.on('create_room', (nickname) => {
      console.log('[Server] create_room event received from:', socket.id, 'nickname:', nickname);
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const room = new RoomLogic(code);
      room.onStateUpdate = () => broadcastState(room);
      room.onAction = (playerId, actionType, cardValue) => {
        io.to(code).emit('play_animation', playerId, actionType, cardValue);
      };
      rooms.set(code, room);
      
      try {
        console.log('[Server] Adding player to room:', code);
        room.addPlayer(socket.id, nickname);
        currentRoomCode = code;
        socket.join(code);
        console.log('[Server] Room created successfully. Code:', code);
        socket.emit('room_created', code);
        broadcastState(room);
      } catch (e: any) {
        console.error('[Server] Error creating room:', e.message);
        socket.emit('error', e.message);
      }
    });

    socket.on('join_room', (code, nickname) => {
      code = code.toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        socket.emit('error', 'Room not found');
        return;
      }
      try {
        room.addPlayer(socket.id, nickname);
        currentRoomCode = code;
        socket.join(code);
        broadcastState(room);
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('add_bot', (count = 1) => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      try {
        if (socket.id !== room.hostId) throw new Error('Only host can add bots');
        for (let i = 0; i < count; i++) {
          room.addBot();
        }
        broadcastState(room);
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('start_game', () => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      try {
        room.startGame(socket.id);
        broadcastState(room);
        io.to(currentRoomCode).emit('play_animation', socket.id, 'started_game');
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('play_card', (cardId) => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      try {
        room.playCard(socket.id, cardId);
        broadcastState(room);
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('draw_card', () => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      try {
        room.drawCard(socket.id);
        broadcastState(room);
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });
    
    socket.on('choose_color', (color) => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      try {
        room.chooseColor(socket.id, color);
        broadcastState(room);
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });
    
    socket.on('call_uno', () => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      try {
        room.callUno(socket.id);
        broadcastState(room);
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      if (currentRoomCode) {
        const room = rooms.get(currentRoomCode);
        if (room) {
          room.removePlayer(socket.id);
          if (room.players.length === 0) {
            rooms.delete(currentRoomCode);
          } else {
            broadcastState(room);
          }
        }
      }
    });
  });

  // Vite Integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Use 0.0.0.0 to bind correctly for external access
  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

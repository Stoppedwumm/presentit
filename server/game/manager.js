const { getTemplate } = require('../db');

class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(templateId, hostSocketId) {
    const template = getTemplate(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    const code = this.generateRoomCode();
    const room = {
      code,
      template,
      hostSocketId,
      displaySocketId: null,
      players: [], // { id, socketId, name, role: 'presenter' | 'audience' }
      status: 'LOBBY',
      votableSlides: [],
      currentVoteSlideIdx: 0,
      slideWinners: {}, // slideIdx -> winning choice/text
      votes: {}, // slideIdx -> { socketId -> choice }
      presenterSlideIdx: 0,
      ratings: [], // { socketId, voterName, score }
    };

    // Filter votable slides
    room.votableSlides = template.slides.filter(s => s.slide_type !== 'predefined');

    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(code ? code.toUpperCase() : '');
  }

  setupSocketEvents(socket) {
    // ── HOST EVENTS ──
    socket.on('host:create_room', ({ templateId }) => {
      try {
        const room = this.createRoom(templateId, socket.id);
        socket.join(room.code);
        socket.emit('room:created', { code: room.code });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('host:select_presenter', ({ playerId }) => {
      const room = this.findRoomBySocket(socket.id);
      if (!room || room.status !== 'LOBBY') return;

      room.players.forEach(p => {
        p.role = (p.id === playerId) ? 'presenter' : 'audience';
      });

      this.emitRoomUpdate(room);
    });

    socket.on('host:start_game', () => {
      const room = this.findRoomBySocket(socket.id);
      if (!room) return;

      if (room.players.length === 0) {
        return socket.emit('error', { message: 'Need at least 1 player to start' });
      }

      // Assign random presenter if none selected
      let presenter = room.players.find(p => p.role === 'presenter');
      if (!presenter && room.players.length > 0) {
        presenter = room.players[Math.floor(Math.random() * room.players.length)];
        presenter.role = 'presenter';
        room.players.forEach(p => {
          if (p.id !== presenter.id) p.role = 'audience';
        });
        this.emitRoomUpdate(room);
      }

      if (room.votableSlides.length > 0) {
        this.startVotingPhase(room);
      } else {
        this.startPresentingPhase(room);
      }
    });

    socket.on('host:restart_game', () => {
      const room = this.findRoomBySocket(socket.id);
      if (!room) return;

      room.status = 'LOBBY';
      room.currentVoteSlideIdx = 0;
      room.slideWinners = {};
      room.votes = {};
      room.presenterSlideIdx = 0;
      room.ratings = [];

      this.io.to(room.code).emit('game:reset', {
        code: room.code,
        players: room.players,
        status: 'LOBBY'
      });

      this.emitRoomUpdate(room);
    });

    socket.on('host:next', () => {
      const room = this.findRoomBySocket(socket.id);
      if (!room) return;

      if (room.status === 'VOTING') {
        this.finishCurrentSlideVote(room);
      } else if (room.status === 'PRESENTING') {
        this.startRatingPhase(room);
      } else if (room.status === 'RATING') {
        this.finishRatingPhase(room);
      }
    });

    // ── DISPLAY EVENTS ──
    socket.on('display:join_room', ({ roomCode }) => {
      const room = this.getRoom(roomCode);
      if (!room) {
        return socket.emit('error', { message: 'Invalid room code' });
      }
      room.displaySocketId = socket.id;
      socket.join(room.code);
      socket.emit('display:joined', { code: room.code, status: room.status, players: room.players });
    });

    // ── PLAYER (MOBILE) EVENTS ──
    socket.on('play:join_room', ({ roomCode, name, playerId }) => {
      const room = this.getRoom(roomCode);
      if (!room) {
        return socket.emit('error', { message: 'Room not found. Check code.' });
      }

      // Check if player is rejoining via playerId or socket.id or name
      let player = room.players.find(p => (playerId && p.id === playerId) || p.socketId === socket.id);
      
      if (!player && name) {
        player = room.players.find(p => p.name.trim().toLowerCase() === name.trim().toLowerCase());
      }

      if (player) {
        // Re-bind socket and update name
        player.socketId = socket.id;
        if (name) player.name = name;
      } else {
        // Create new player
        player = {
          id: playerId || `p_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          socketId: socket.id,
          name: name || `Player ${room.players.length + 1}`,
          role: 'audience'
        };
        room.players.push(player);
      }

      socket.join(room.code);
      socket.emit('play:joined', {
        code: room.code,
        player,
        status: room.status
      });

      this.emitRoomUpdate(room);

      // If game already in progress, sync player state
      if (room.status === 'VOTING') {
        this.syncPlayerVotingState(socket, room);
      } else if (room.status === 'PRESENTING') {
        this.syncPlayerPresentingState(socket, room);
      } else if (room.status === 'RATING') {
        socket.emit('game:rating', { presenterName: this.getPresenterName(room) });
      }
    });

    socket.on('vote:submit', ({ choice, text }) => {
      const room = this.findRoomBySocket(socket.id);
      if (!room || room.status !== 'VOTING') return;

      const slideIdx = room.currentVoteSlideIdx;
      if (!room.votes[slideIdx]) {
        room.votes[slideIdx] = {};
      }

      room.votes[slideIdx][socket.id] = { choice, text };

      // Update progress to host & display
      const audienceCount = room.players.filter(p => p.role !== 'presenter').length;
      const votesIn = Object.keys(room.votes[slideIdx]).length;

      this.io.to(room.code).emit('game:vote_progress', {
        votesIn,
        votersTotal: audienceCount
      });

      socket.emit('vote:confirmed', { choice, text });

      // Auto advance if all audience voted
      if (votesIn >= audienceCount && audienceCount > 0) {
        this.finishCurrentSlideVote(room);
      }
    });

    socket.on('presenter:slide_change', ({ action }) => {
      const room = this.findRoomBySocket(socket.id);
      if (!room || room.status !== 'PRESENTING') return;

      const presenter = room.players.find(p => p.role === 'presenter');
      if (presenter && presenter.socketId !== socket.id) return; // Only presenter can trigger

      if (action === 'next') {
        const finalDeck = this.buildFinalDeck(room);
        if (room.presenterSlideIdx < finalDeck.length - 1) {
          room.presenterSlideIdx++;
        } else {
          // Finished presentation! Move to rating
          this.startRatingPhase(room);
          return;
        }
      } else if (action === 'prev') {
        if (room.presenterSlideIdx > 0) {
          room.presenterSlideIdx--;
        }
      }

      this.emitCurrentPresenterSlide(room);
    });

    socket.on('rating:submit', ({ score }) => {
      const room = this.findRoomBySocket(socket.id);
      if (!room || room.status !== 'RATING') return;

      const player = room.players.find(p => p.socketId === socket.id);
      if (!player || player.role === 'presenter') return; // Presenter doesn't rate themselves

      const existingIdx = room.ratings.findIndex(r => r.socketId === socket.id);
      const val = Math.min(10, Math.max(1, parseInt(score, 10) || 5));

      if (existingIdx >= 0) {
        room.ratings[existingIdx].score = val;
      } else {
        room.ratings.push({
          socketId: socket.id,
          voterName: player.name,
          score: val
        });
      }

      socket.emit('rating:confirmed', { score: val });

      const audienceCount = room.players.filter(p => p.role !== 'presenter').length;
      if (room.ratings.length >= audienceCount && audienceCount > 0) {
        this.finishRatingPhase(room);
      }
    });

    socket.on('disconnect', () => {
      const room = this.findRoomBySocket(socket.id);
      if (room) {
        room.players = room.players.filter(p => p.socketId !== socket.id);
        this.emitRoomUpdate(room);
      }
    });
  }

  startVotingPhase(room) {
    room.status = 'VOTING';
    room.currentVoteSlideIdx = 0;
    this.sendCurrentVoteSlide(room);
  }

  sendCurrentVoteSlide(room) {
    const slide = room.votableSlides[room.currentVoteSlideIdx];
    if (!slide) {
      this.startPresentingPhase(room);
      return;
    }

    const audienceCount = room.players.filter(p => p.role !== 'presenter').length;

    const payload = {
      type: 'vote',
      slideType: slide.slide_type,
      question: slide.question,
      options: slide.options,
      imageUrl: slide.image_url,
      contentText: slide.content_text,
      index: room.currentVoteSlideIdx,
      total: room.votableSlides.length,
      votersTotal: audienceCount
    };

    // Broadcast slide to all sockets in room
    this.io.to(room.code).emit('game:slide', payload);
  }

  finishCurrentSlideVote(room) {
    const slide = room.votableSlides[room.currentVoteSlideIdx];
    if (!slide) return;

    const votes = room.votes[room.currentVoteSlideIdx] || {};
    const optionCounts = {};

    Object.values(votes).forEach(v => {
      const choice = v.choice || v.text;
      if (choice) {
        optionCounts[choice] = (optionCounts[choice] || 0) + 1;
      }
    });

    // Find winner option
    let winner = null;
    let maxVotes = -1;
    Object.entries(optionCounts).forEach(([opt, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        winner = opt;
      }
    });

    // Fallback if no votes: pick random option
    if (!winner && slide.options && slide.options.length > 0) {
      const firstOpt = slide.options[0];
      winner = typeof firstOpt === 'string' ? firstOpt : (firstOpt.caption || firstOpt.text || firstOpt.id);
    }

    room.slideWinners[slide.id] = winner || 'No votes';

    // Format results for host/display
    const results = Object.entries(optionCounts).map(([opt, cnt]) => ({
      option: opt,
      votes: cnt
    })).sort((a, b) => b.votes - a.votes);

    this.io.to(room.code).emit('game:vote_results', {
      slideId: slide.id,
      question: slide.question,
      results,
      winner
    });

    // Short pause then next vote slide or start presentation
    setTimeout(() => {
      if (room.currentVoteSlideIdx < room.votableSlides.length - 1) {
        room.currentVoteSlideIdx++;
        this.sendCurrentVoteSlide(room);
      } else {
        this.startPresentingPhase(room);
      }
    }, 2500);
  }

  startPresentingPhase(room) {
    room.status = 'PRESENTING';
    room.presenterSlideIdx = 0;

    // Notify presenter remote
    const presenter = room.players.find(p => p.role === 'presenter');
    if (presenter) {
      this.io.to(presenter.socketId).emit('game:presenter_remote', {
        slides: this.buildFinalDeck(room)
      });
    }

    this.emitCurrentPresenterSlide(room);
  }

  buildFinalDeck(room) {
    const deck = [];

    room.template.slides.forEach(s => {
      const winner = room.slideWinners[s.id];

      if (s.slide_type === 'predefined') {
        deck.push({
          id: s.id,
          slideType: 'predefined',
          question: '',
          contentText: s.content_text || s.question || '',
          imageUrl: null
        });
      } else if (s.slide_type === 'photo_and_text') {
        let displayContent = '';
        let displayImage = null;
        if (s.options && s.options.length > 0) {
          const match = s.options.find(o => o.id === winner || o.caption === winner || o.text === winner || o.image_url === winner);
          if (match) {
            displayImage = match.image_url || null;
            displayContent = match.caption || match.text || winner || '';
          } else {
            displayContent = winner || '';
          }
        } else {
          displayContent = winner || s.content_text || '';
          displayImage = s.image_url || null;
        }

        deck.push({
          id: s.id,
          slideType: 'photo_and_text',
          question: s.question,
          contentText: displayContent,
          imageUrl: displayImage
        });
      } else if (s.slide_type === 'photo_options') {
        // Slide 1: Question/prompt
        deck.push({
          id: `${s.id}_prompt`,
          slideType: 'prompt',
          question: s.question,
          contentText: '',
          imageUrl: null
        });

        // Slide 2: Photo only
        let winnerImage = null;
        if (s.options) {
          const match = s.options.find(o => o.id === winner || o.caption === winner || o.image_url === winner);
          if (match) {
            winnerImage = match.image_url;
          }
        }
        if (!winnerImage && winner && (winner.startsWith('/') || winner.startsWith('http'))) {
          winnerImage = winner;
        }

        deck.push({
          id: `${s.id}_answer`,
          slideType: 'photo_only',
          question: '',
          contentText: '',
          imageUrl: winnerImage
        });
      } else if (s.slide_type === 'text_options') {
        // Slide 1: Question/prompt
        deck.push({
          id: `${s.id}_prompt`,
          slideType: 'prompt',
          question: s.question,
          contentText: '',
          imageUrl: null
        });

        // Slide 2: Answer text only
        deck.push({
          id: `${s.id}_answer`,
          slideType: 'answer_only',
          question: '',
          contentText: winner || 'No answer',
          imageUrl: null
        });
      }
    });

    return deck;
  }

  emitCurrentPresenterSlide(room) {
    const finalDeck = this.buildFinalDeck(room);
    const currentSlide = finalDeck[room.presenterSlideIdx] || {};

    const presenter = room.players.find(p => p.role === 'presenter');

    this.io.to(room.code).emit('game:presenter_slide', {
      slide: currentSlide,
      index: room.presenterSlideIdx,
      total: finalDeck.length,
      presenterName: presenter ? presenter.name : 'Presenter'
    });
  }

  startRatingPhase(room) {
    room.status = 'RATING';
    const presenterName = this.getPresenterName(room);
    this.io.to(room.code).emit('game:rating', { presenterName });
  }

  finishRatingPhase(room) {
    room.status = 'FINISHED';

    let totalScore = 0;
    room.ratings.forEach(r => totalScore += r.score);
    const avg = room.ratings.length > 0 ? (totalScore / room.ratings.length).toFixed(1) : '10.0';

    this.io.to(room.code).emit('game:results', {
      presenterName: this.getPresenterName(room),
      average: avg,
      ratings: room.ratings
    });
  }

  syncPlayerVotingState(socket, room) {
    const slide = room.votableSlides[room.currentVoteSlideIdx];
    if (!slide) return;

    socket.emit('game:slide', {
      type: 'vote',
      slideType: slide.slide_type,
      question: slide.question,
      options: slide.options,
      imageUrl: slide.image_url,
      contentText: slide.content_text,
      index: room.currentVoteSlideIdx,
      total: room.votableSlides.length
    });
  }

  syncPlayerPresentingState(socket, room) {
    const player = room.players.find(p => p.socketId === socket.id);
    if (player && player.role === 'presenter') {
      socket.emit('game:presenter_remote', {
        slides: this.buildFinalDeck(room)
      });
    }
  }

  getPresenterName(room) {
    const p = room.players.find(p => p.role === 'presenter');
    return p ? p.name : 'The Presenter';
  }

  findRoomBySocket(socketId) {
    for (const room of this.rooms.values()) {
      if (room.hostSocketId === socketId ||
          room.displaySocketId === socketId ||
          room.players.some(p => p.socketId === socketId)) {
        return room;
      }
    }
    return null;
  }

  emitRoomUpdate(room) {
    const presenter = room.players.find(p => p.role === 'presenter');
    this.io.to(room.code).emit('room:update', {
      players: room.players,
      presenter: presenter ? { id: presenter.id, name: presenter.name } : null,
      status: room.status
    });
  }
}

module.exports = GameManager;

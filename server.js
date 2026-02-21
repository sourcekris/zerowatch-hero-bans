const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let state = {
    phase: 'waiting', // waiting, toss, toss_result, banning, finished
    players: [],
    turn: null,
    bans: [], // { player: socketId, hero: string }
    timer: 60,
    turnCount: 0,
    tossWinner: null
};

let timerInterval;

function startTimer() {
    clearInterval(timerInterval);
    state.timer = 60;
    timerInterval = setInterval(() => {
        state.timer--;
        io.emit('state_update', state);
        
        if (state.timer <= 0) {
            // Auto-skip if they don't pick
            switchTurn();
        }
    }, 1000);
}

function switchTurn() {
    state.turnCount++;
    if (state.turnCount >= 4) {
        state.phase = 'finished';
        clearInterval(timerInterval);
    } else {
        state.turn = state.turn === state.players[0].id ? state.players[1].id : state.players[0].id;
        startTimer();
    }
    io.emit('state_update', state);
}

io.on('connection', (socket) => {
    socket.emit('state_update', state);

    socket.on('join_captain', (name) => {
        if (state.players.length < 2) {
            state.players.push({ id: socket.id, name });
            if (state.players.length === 2) {
                // Coin toss sequence
                state.phase = 'toss';
                const winnerIdx = Math.random() < 0.5 ? 0 : 1;
                state.tossWinner = state.players[winnerIdx].id;
                state.turn = state.tossWinner;
                
                io.emit('state_update', state);

                // Wait 5 seconds for animation before showing result
                setTimeout(() => {
                    if (state.players.length === 2) {
                        state.phase = 'toss_result';
                        io.emit('state_update', state);

                        // Wait another 3 seconds for result announcement before starting bans
                        setTimeout(() => {
                            if (state.players.length === 2) {
                                state.phase = 'banning';
                                state.turnCount = 0;
                                startTimer();
                                io.emit('state_update', state);
                            }
                        }, 3000);
                    }
                }, 5000);
            } else {
                io.emit('state_update', state);
            }
        }
    });

    socket.on('ban_hero', (heroName) => {
        if (state.phase === 'banning' && state.turn === socket.id) {
            // Check if hero is already banned
            if (!state.bans.find(b => b.hero === heroName)) {
                state.bans.push({ player: socket.id, hero: heroName });
                switchTurn();
            }
        }
    });

    socket.on('skip_turn', () => {
        if (state.phase === 'banning' && state.turn === socket.id) {
            switchTurn();
        }
    });

    socket.on('disconnect', () => {
        state.players = state.players.filter(p => p.id !== socket.id);
        if (state.players.length < 2) {
            state.phase = 'waiting';
            state.bans = [];
            state.turnCount = 0;
            clearInterval(timerInterval);
            io.emit('state_update', state);
        }
    });
});

// --- UPDATED PORT CONFIGURATION ---
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Zerowatch server running on port ${PORT}`);
});

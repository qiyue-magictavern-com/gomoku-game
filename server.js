const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 8080;
const ROOM_CODE_LENGTH = 4;

// 房间数据
const rooms = new Map();

// 生成房间码
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// HTTP 服务器
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        fs.readFile(path.join(__dirname, 'gomoku-lan.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading game');
            } else {
                res.writeHead(200, { 
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate, max-age=0',
                    'Pragma': 'no-cache',
                    'Expires': '0',
                    'Surrogate-Control': 'no-store'
                });
                res.end(data);
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// WebSocket 服务器
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.room = null;
    ws.player = null;
    ws.isHost = false;

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            handleMessage(ws, msg);
        } catch (e) {
            console.error('Invalid message:', e);
        }
    });

    ws.on('close', () => {
        if (ws.room) {
            const room = rooms.get(ws.room);
            if (room) {
                // 通知对方
                if (room.host && room.host !== ws) {
                    room.host.send(JSON.stringify({ type: 'opponentLeft' }));
                }
                if (room.guest && room.guest !== ws) {
                    room.guest.send(JSON.stringify({ type: 'opponentLeft' }));
                }
                // 删除房间
                rooms.delete(ws.room);
            }
        }
    });
});

function handleMessage(ws, msg) {
    switch (msg.type) {
        case 'createRoom': {
            let roomCode;
            do {
                roomCode = generateRoomCode();
            } while (rooms.has(roomCode));

            rooms.set(roomCode, { host: ws, guest: null, board: [], currentPlayer: 'black', gameOver: false });
            ws.room = roomCode;
            ws.player = 'black';
            ws.isHost = true;

            ws.send(JSON.stringify({ type: 'roomCreated', roomCode, player: 'black' }));
            console.log(`Room ${roomCode} created by host`);
            break;
        }

        case 'joinRoom': {
            const room = rooms.get(msg.roomCode);
            if (!room) {
                ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
                return;
            }
            if (room.guest) {
                ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
                return;
            }

            room.guest = ws;
            ws.room = msg.roomCode;
            ws.player = 'white';
            ws.isHost = false;

            // 通知双方游戏开始
            room.host.send(JSON.stringify({ 
                type: 'gameStart', 
                opponent: 'white',
                currentPlayer: 'black'
            }));
            ws.send(JSON.stringify({ 
                type: 'gameStart', 
                opponent: 'black',
                currentPlayer: 'black'
            }));

            console.log(`Player joined room ${msg.roomCode}`);
            break;
        }

        case 'move': {
            const room = rooms.get(ws.room);
            if (!room || room.gameOver) return;

            // 验证是否是当前玩家
            if (msg.player !== room.currentPlayer) return;

            // 记录落子
            room.board.push({ row: msg.row, col: msg.col, player: msg.player });

            // 广播落子给双方
            const moveMsg = JSON.stringify({ 
                type: 'move', 
                row: msg.row, 
                col: msg.col, 
                player: msg.player 
            });
            
            if (room.host) room.host.send(moveMsg);
            if (room.guest) room.guest.send(moveMsg);

            // 检查胜负
            if (checkWin(room.board, msg.row, msg.col, msg.player)) {
                room.gameOver = true;
                const winMsg = JSON.stringify({ type: 'gameOver', winner: msg.player });
                if (room.host) room.host.send(winMsg);
                if (room.guest) room.guest.send(winMsg);
            } else {
                // 切换玩家
                room.currentPlayer = room.currentPlayer === 'black' ? 'white' : 'black';
                const switchMsg = JSON.stringify({ type: 'switchPlayer', player: room.currentPlayer });
                if (room.host) room.host.send(switchMsg);
                if (room.guest) room.guest.send(switchMsg);
            }
            break;
        }

        case 'restart': {
            const room = rooms.get(ws.room);
            if (!room) return;

            room.board = [];
            room.currentPlayer = 'black';
            room.gameOver = false;

            const restartMsg = JSON.stringify({ type: 'restart', currentPlayer: 'black' });
            if (room.host) room.host.send(restartMsg);
            if (room.guest) room.guest.send(restartMsg);
            break;
        }
    }
}

function checkWin(board, row, col, player) {
    // 重建棋盘
    const grid = Array(15).fill(null).map(() => Array(15).fill(null));
    board.forEach(m => {
        grid[m.row][m.col] = m.player;
    });

    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    
    for (const [dr, dc] of directions) {
        let count = 1;
        
        // 正向
        for (let i = 1; i < 5; i++) {
            const r = row + dr * i;
            const c = col + dc * i;
            if (r < 0 || r >= 15 || c < 0 || c >= 15 || grid[r][c] !== player) break;
            count++;
        }
        
        // 反向
        for (let i = 1; i < 5; i++) {
            const r = row - dr * i;
            const c = col - dc * i;
            if (r < 0 || r >= 15 || c < 0 || c >= 15 || grid[r][c] !== player) break;
            count++;
        }
        
        if (count >= 5) return true;
    }
    return false;
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Gomoku LAN server running on http://0.0.0.0:${PORT}`);
});

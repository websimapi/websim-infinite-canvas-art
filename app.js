// Import libraries
import React from 'react';
import { createRoot } from 'react-dom/client';

// Canvas size and settings
const CELL_SIZE = 500; // Size of each cell in the infinite grid
const MINIMAP_SCALE = 0.05; // Scale for the minimap
const BRUSH_PREVIEW_SIZE = 20; // Size of the brush preview

// Initialize the WebsimSocket for multiplayer
const room = new WebsimSocket();

// Main canvas state
let canvas, ctx;
let minimapCanvas, minimapCtx;
let canvasOffset = { x: 0, y: 0 };
let viewportOffset = { x: 0, y: 0 };
let scale = 1;
let isPanning = false;
let lastPointerPos = { x: 0, y: 0 };
let isDrawing = false;
let userCells = new Map(); // Map to track which cells have been loaded/created
let loadedCells = new Set(); // Set to track which cells are currently loaded

// Drawing settings
let brushSize = 5;
let brushColor = '#000000';
let currentTool = 'brush';

// Audio
let backgroundMusic;
let musicStarted = false;

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);

async function init() {
    // Setup canvas
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();

    // Setup minimap
    minimapCanvas = document.getElementById('minimap');
    minimapCtx = minimapCanvas.getContext('2d');
    minimapCanvas.width = 200;
    minimapCanvas.height = 200;

    // Setup audio
    backgroundMusic = document.getElementById('background-music');
    
    // Setup start button
    const startButton = document.getElementById('start-button');
    startButton.addEventListener('click', startExperience);
    
    // Show the start prompt
    document.getElementById('start-prompt').classList.add('visible');
    
    // Set initial view
    resetView();

    // Load data from database
    await loadInitialData();

    // Hide loading screen and show controls
    document.getElementById('loading').style.display = 'none';
    document.getElementById('controls').classList.remove('hidden');

    // Setup event listeners
    setupEventListeners();

    // Update online users count
    updateOnlineUsersCount();

    // Start animation loop
    requestAnimationFrame(render);
}

function startExperience() {
    // Hide start prompt
    document.getElementById('start-prompt').classList.remove('visible');
    
    // Start music
    if (!musicStarted) {
        backgroundMusic.play();
        musicStarted = true;
    }
}

async function loadInitialData() {
    // Get visible cells
    const visibleCells = getVisibleCells();
    
    // Load data for each visible cell
    for (const cellCoord of visibleCells) {
        await loadCell(cellCoord);
    }
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function setupEventListeners() {
    // Canvas interaction
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerUp);
    canvas.addEventListener('wheel', handleWheel);

    // Tools
    document.getElementById('brush').addEventListener('click', () => setTool('brush'));
    document.getElementById('color-picker').addEventListener('input', (e) => {
        brushColor = e.target.value;
        updatePresence();
    });
    document.getElementById('brush-size').addEventListener('input', (e) => {
        brushSize = parseInt(e.target.value);
        updatePresence();
    });
    document.getElementById('reset-view').addEventListener('click', resetView);

    // Window resize
    window.addEventListener('resize', () => {
        resizeCanvas();
        updateVisibleCells();
    });

    // Handle multiplayer events
    room.onmessage = handleRoomMessage;

    // Subscribe to presence updates
    room.party.subscribePresence(updateCursors);
}

function handlePointerDown(e) {
    const pos = getCanvasPointerPosition(e);
    lastPointerPos = pos;
    
    if (e.button === 0) { // Left click
        if (currentTool === 'brush') {
            isDrawing = true;
            drawStroke(pos.x, pos.y, pos.x, pos.y, brushSize, brushColor);
        }
    } else if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) { // Middle click or Right click or Alt+Left click
        isPanning = true;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return false;
    }
}

function handlePointerMove(e) {
    const pos = getCanvasPointerPosition(e);
    
    // Update coordinates display
    document.getElementById('coordinates').textContent = `${Math.floor(pos.x)}, ${Math.floor(pos.y)}`;
    
    // Update user presence
    room.party.updatePresence({
        x: pos.x,
        y: pos.y,
        brushSize,
        brushColor,
        isDrawing
    });
    
    if (isPanning) {
        panCanvas(pos.x - lastPointerPos.x, pos.y - lastPointerPos.y);
    } else if (isDrawing && currentTool === 'brush') {
        drawStroke(lastPointerPos.x, lastPointerPos.y, pos.x, pos.y, brushSize, brushColor);
        
        // Send draw event
        room.send({
            type: 'draw',
            startX: lastPointerPos.x,
            startY: lastPointerPos.y,
            endX: pos.x,
            endY: pos.y,
            size: brushSize,
            color: brushColor
        });
    }
    
    lastPointerPos = pos;
}

function handlePointerUp() {
    isPanning = false;
    isDrawing = false;
    canvas.style.cursor = 'crosshair';
    
    // Update presence to indicate not drawing
    room.party.updatePresence({
        isDrawing: false
    });
}

function handleWheel(e) {
    const pos = getCanvasPointerPosition(e);
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    zoomCanvas(pos.x, pos.y, delta);
    e.preventDefault();
}

function handleRoomMessage(event) {
    const data = event.data;
    
    switch (data.type) {
        case 'connected':
        case 'disconnected':
            updateOnlineUsersCount();
            break;
        case 'draw':
            // Draw the stroke from another user
            drawStroke(data.startX, data.startY, data.endX, data.endY, data.size, data.color);
            break;
    }
}

function updateOnlineUsersCount() {
    const count = Object.keys(room.party.peers).length;
    document.getElementById('online-users').textContent = `${count} online`;
}

function updatePresence() {
    room.party.updatePresence({
        brushSize,
        brushColor
    });
}

function updateCursors(presence) {
    // We'll handle cursor rendering in the animation frame
}

function getCanvasPointerPosition(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale + viewportOffset.x;
    const y = (e.clientY - rect.top) / scale + viewportOffset.y;
    return { x, y };
}

function panCanvas(dx, dy) {
    viewportOffset.x -= dx / scale;
    viewportOffset.y -= dy / scale;
    updateVisibleCells();
}

function zoomCanvas(x, y, delta) {
    const oldScale = scale;
    scale *= delta;
    scale = Math.min(Math.max(0.1, scale), 10);
    
    // Adjust offset to zoom into/out of the point under the cursor
    viewportOffset.x += (x - viewportOffset.x) * (1 - scale / oldScale);
    viewportOffset.y += (y - viewportOffset.y) * (1 - scale / oldScale);
    
    updateVisibleCells();
}

function resetView() {
    scale = 1;
    viewportOffset = { x: 0, y: 0 };
    updateVisibleCells();
}

function getCellCoord(x, y) {
    const cellX = Math.floor(x / CELL_SIZE);
    const cellY = Math.floor(y / CELL_SIZE);
    return `${cellX},${cellY}`;
}

function getVisibleCells() {
    const cells = new Set();
    
    // Calculate the visible area in world coordinates
    const visibleLeft = viewportOffset.x;
    const visibleTop = viewportOffset.y;
    const visibleRight = visibleLeft + canvas.width / scale;
    const visibleBottom = visibleTop + canvas.height / scale;
    
    // Convert to cell coordinates and add a buffer
    const startCellX = Math.floor(visibleLeft / CELL_SIZE) - 1;
    const startCellY = Math.floor(visibleTop / CELL_SIZE) - 1;
    const endCellX = Math.floor(visibleRight / CELL_SIZE) + 1;
    const endCellY = Math.floor(visibleBottom / CELL_SIZE) + 1;
    
    // Add all visible cells to the set
    for (let cellX = startCellX; cellX <= endCellX; cellX++) {
        for (let cellY = startCellY; cellY <= endCellY; cellY++) {
            cells.add(`${cellX},${cellY}`);
        }
    }
    
    return cells;
}

async function updateVisibleCells() {
    const visibleCells = getVisibleCells();
    
    // Load new cells that became visible
    for (const cellCoord of visibleCells) {
        if (!loadedCells.has(cellCoord)) {
            await loadCell(cellCoord);
        }
    }
    
    // Unload cells that are no longer visible
    for (const cellCoord of loadedCells) {
        if (!visibleCells.has(cellCoord)) {
            unloadCell(cellCoord);
        }
    }
}

async function loadCell(cellCoord) {
    loadedCells.add(cellCoord);
    
    // Check if we've loaded this cell before
    if (!userCells.has(cellCoord)) {
        // Create cell canvas
        const cellCanvas = document.createElement('canvas');
        cellCanvas.width = CELL_SIZE;
        cellCanvas.height = CELL_SIZE;
        userCells.set(cellCoord, cellCanvas);
        
        // Load cell data from database
        try {
            const strokes = await room.collection('stroke').filter({ cellCoord }).getList();
            
            if (strokes.length > 0) {
                const cellCtx = cellCanvas.getContext('2d');
                
                // Draw all strokes in this cell
                for (const stroke of strokes) {
                    cellCtx.beginPath();
                    cellCtx.moveTo(stroke.startX % CELL_SIZE, stroke.startY % CELL_SIZE);
                    cellCtx.lineTo(stroke.endX % CELL_SIZE, stroke.endY % CELL_SIZE);
                    cellCtx.strokeStyle = stroke.color;
                    cellCtx.lineWidth = stroke.size;
                    cellCtx.lineCap = 'round';
                    cellCtx.stroke();
                }
            }
        } catch (error) {
            console.error('Error loading cell data:', error);
        }
    }
}

function unloadCell(cellCoord) {
    loadedCells.delete(cellCoord);
    // Note: We keep the cell's canvas in userCells for reuse
}

function drawStroke(startX, startY, endX, endY, size, color) {
    // Draw on main canvas
    ctx.save();
    ctx.lineWidth = size;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.restore();
    
    // Draw on minimap
    minimapCtx.save();
    minimapCtx.lineWidth = size * MINIMAP_SCALE;
    minimapCtx.strokeStyle = color;
    minimapCtx.lineCap = 'round';
    minimapCtx.beginPath();
    minimapCtx.moveTo(startX * MINIMAP_SCALE + minimapCanvas.width/2, startY * MINIMAP_SCALE + minimapCanvas.height/2);
    minimapCtx.lineTo(endX * MINIMAP_SCALE + minimapCanvas.width/2, endY * MINIMAP_SCALE + minimapCanvas.height/2);
    minimapCtx.stroke();
    minimapCtx.restore();
    
    // Get cells affected by this stroke
    const startCellCoord = getCellCoord(startX, startY);
    const endCellCoord = getCellCoord(endX, endY);
    
    // Update each affected cell's canvas
    const affectedCells = new Set([startCellCoord, endCellCoord]);
    for (const cellCoord of affectedCells) {
        // Ensure cell exists
        if (!userCells.has(cellCoord)) {
            const cellCanvas = document.createElement('canvas');
            cellCanvas.width = CELL_SIZE;
            cellCanvas.height = CELL_SIZE;
            userCells.set(cellCoord, cellCanvas);
        }
        
        // Draw on cell canvas
        const cellCanvas = userCells.get(cellCoord);
        const cellCtx = cellCanvas.getContext('2d');
        
        // Convert world coordinates to cell-local coordinates
        const [cellX, cellY] = cellCoord.split(',').map(Number);
        const localStartX = startX - cellX * CELL_SIZE;
        const localStartY = startY - cellY * CELL_SIZE;
        const localEndX = endX - cellX * CELL_SIZE;
        const localEndY = endY - cellY * CELL_SIZE;
        
        cellCtx.lineWidth = size;
        cellCtx.strokeStyle = color;
        cellCtx.lineCap = 'round';
        cellCtx.beginPath();
        cellCtx.moveTo(localStartX, localStartY);
        cellCtx.lineTo(localEndX, localEndY);
        cellCtx.stroke();
    }
    
    // Store stroke in database
    storeStroke(startX, startY, endX, endY, size, color, startCellCoord);
}

async function storeStroke(startX, startY, endX, endY, size, color, cellCoord) {
    try {
        await room.collection('stroke').create({
            startX,
            startY,
            endX,
            endY,
            size,
            color,
            cellCoord
        });
    } catch (error) {
        console.error('Error storing stroke:', error);
    }
}

function render() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Apply transformations
    ctx.save();
    ctx.translate(-viewportOffset.x * scale, -viewportOffset.y * scale);
    ctx.scale(scale, scale);
    
    // Draw grid (optional)
    drawGrid();
    
    // Draw all visible cells
    drawVisibleCells();
    
    // Draw cursors
    drawCursors();
    
    // Restore transformation
    ctx.restore();
    
    // Draw minimap
    updateMinimap();
    
    // Request next frame
    requestAnimationFrame(render);
}

function drawGrid() {
    const gridSize = 100;
    const startX = Math.floor(viewportOffset.x / gridSize) * gridSize;
    const startY = Math.floor(viewportOffset.y / gridSize) * gridSize;
    const endX = viewportOffset.x + canvas.width / scale;
    const endY = viewportOffset.y + canvas.height / scale;
    
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.2)';
    ctx.lineWidth = 1;
    
    // Draw vertical lines
    for (let x = startX; x <= endX; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
        ctx.stroke();
    }
    
    // Draw horizontal lines
    for (let y = startY; y <= endY; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
    }
}

function drawVisibleCells() {
    for (const cellCoord of loadedCells) {
        if (userCells.has(cellCoord)) {
            const [cellX, cellY] = cellCoord.split(',').map(Number);
            const cellCanvas = userCells.get(cellCoord);
            
            const x = cellX * CELL_SIZE;
            const y = cellY * CELL_SIZE;
            
            ctx.drawImage(cellCanvas, x, y);
        }
    }
}

function drawCursors() {
    for (const clientId in room.party.presence) {
        if (clientId === room.party.client.id) continue; // Skip own cursor
        
        const peer = room.party.presence[clientId];
        if (peer && peer.x !== undefined && peer.y !== undefined) {
            // Draw cursor
            ctx.beginPath();
            ctx.arc(peer.x, peer.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = peer.brushColor || '#FF0000';
            ctx.fill();
            
            // Draw username
            const username = room.party.peers[clientId]?.username || 'Anonymous';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#000000';
            ctx.fillText(username, peer.x + 10, peer.y - 10);
            
            // Draw brush preview if they're drawing
            if (peer.isDrawing) {
                ctx.beginPath();
                ctx.arc(peer.x, peer.y, peer.brushSize / 2, 0, Math.PI * 2);
                ctx.strokeStyle = peer.brushColor;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }
}

function updateMinimap() {
    // Clear minimap
    minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    
    // Draw background
    minimapCtx.fillStyle = '#f0f0f0';
    minimapCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    
    // Draw minimap center reference
    minimapCtx.strokeStyle = '#888';
    minimapCtx.lineWidth = 1;
    minimapCtx.beginPath();
    minimapCtx.moveTo(minimapCanvas.width/2, 0);
    minimapCtx.lineTo(minimapCanvas.width/2, minimapCanvas.height);
    minimapCtx.moveTo(0, minimapCanvas.height/2);
    minimapCtx.lineTo(minimapCanvas.width, minimapCanvas.height/2);
    minimapCtx.stroke();
    
    // Transform to the center
    minimapCtx.save();
    minimapCtx.translate(minimapCanvas.width/2, minimapCanvas.height/2);
    
    // Draw viewport rectangle
    const vpWidth = canvas.width / scale * MINIMAP_SCALE;
    const vpHeight = canvas.height / scale * MINIMAP_SCALE;
    const vpX = -viewportOffset.x * MINIMAP_SCALE - vpWidth/2;
    const vpY = -viewportOffset.y * MINIMAP_SCALE - vpHeight/2;
    
    minimapCtx.strokeStyle = '#FF0000';
    minimapCtx.lineWidth = 2;
    minimapCtx.strokeRect(vpX, vpY, vpWidth, vpHeight);
    
    // Restore transformation
    minimapCtx.restore();
}

function setTool(tool) {
    currentTool = tool;
    
    // Update UI
    document.querySelectorAll('.tool').forEach(el => el.classList.remove('active'));
    document.getElementById(tool).classList.add('active');
}


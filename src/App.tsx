import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, ChevronDown, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';

const COLS = 10;
const ROWS = 20;
const INITIAL_DROP_SPEED = 800;
const SPEED_INCREMENT = 0.9;
const MIN_SPEED = 100;

class SoundManager {
  private ctx: AudioContext | null = null;
  private init() {
    if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  private playTone(freq: number, type: OscillatorType, duration: number, volume = 0.1) {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }
  playMove() { this.playTone(150, 'square', 0.05, 0.05); }
  playRotate() { this.playTone(200, 'square', 0.08, 0.05); }
  playLand() { this.playTone(80, 'triangle', 0.1, 0.1); }
  playClear(lines: number) {
    const freqs = [330, 440, 550, 660];
    freqs.slice(0, lines).forEach((f, i) => setTimeout(() => this.playTone(f, 'square', 0.2, 0.05), i * 100));
  }
  playLevelUp() { [440, 554, 659, 880].forEach((f, i) => setTimeout(() => this.playTone(f, 'square', 0.3, 0.05), i * 150)); }
  playGameOver() { this.playTone(220, 'sawtooth', 1, 0.05); }
}

const sounds = new SoundManager();

const TETROMINOES = {
  I: { shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
  J: { shape: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
  L: { shape: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
  O: { shape: [[1, 1], [1, 1]] },
  S: { shape: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
  T: { shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
  Z: { shape: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
};

type TetrominoKey = keyof typeof TETROMINOES;
interface Piece { pos: { x: number; y: number }; shape: number[][]; type: TetrominoKey; }

const createGrid = () => Array.from({ length: ROWS }, () => Array(COLS).fill(0));
const randomPiece = (): Piece => {
  const keys = Object.keys(TETROMINOES) as TetrominoKey[];
  const type = keys[Math.floor(Math.random() * keys.length)];
  return { pos: { x: Math.floor(COLS / 2) - 1, y: 0 }, shape: TETROMINOES[type].shape, type };
};

export default function App() {
  const [grid, setGrid] = useState<number[][]>(createGrid());
  const [activePiece, setActivePiece] = useState<Piece | null>(null);
  const [nextPiece, setNextPiece] = useState<Piece>(randomPiece());
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [gameOver, setGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);

  const requestRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const dropCounterRef = useRef<number>(0);
  const dropIntervalRef = useRef<number>(INITIAL_DROP_SPEED);

  const checkCollision = (piece: Piece, newPos = piece.pos, newShape = piece.shape) => {
    for (let y = 0; y < newShape.length; y++) {
      for (let x = 0; x < newShape[y].length; x++) {
        if (newShape[y][x] !== 0) {
          const newX = newPos.x + x;
          const newY = newPos.y + y;
          if (newX < 0 || newX >= COLS || newY >= ROWS || (newY >= 0 && grid[newY][newX] !== 0)) return true;
        }
      }
    }
    return false;
  };

  const mergePiece = (piece: Piece) => {
    const newGrid = grid.map(row => [...row]);
    piece.shape.forEach((row, y) => row.forEach((val, x) => {
      if (val !== 0) {
        const newY = piece.pos.y + y;
        const newX = piece.pos.x + x;
        if (newY >= 0) newGrid[newY][newX] = 1;
      }
    }));
    return newGrid;
  };

  const clearLines = (currentGrid: number[][]) => {
    let linesCleared = 0;
    const newGrid = currentGrid.filter(row => {
      const isFull = row.every(cell => cell !== 0);
      if (isFull) linesCleared++;
      return !isFull;
    });
    while (newGrid.length < ROWS) newGrid.unshift(Array(COLS).fill(0));
    if (linesCleared > 0) {
      sounds.playClear(linesCleared);
      setScore(s => s + [0, 100, 300, 500, 800][linesCleared] * level);
    }
    return newGrid;
  };

  const drop = useCallback(() => {
    if (!activePiece) return;
    const newPos = { ...activePiece.pos, y: activePiece.pos.y + 1 };
    if (!checkCollision(activePiece, newPos)) {
      setActivePiece({ ...activePiece, pos: newPos });
    } else {
      sounds.playLand();
      if (activePiece.pos.y <= 0) { setGameOver(true); sounds.playGameOver(); return; }
      const newGrid = mergePiece(activePiece);
      setGrid(clearLines(newGrid));
      setActivePiece(nextPiece);
      setNextPiece(randomPiece());
    }
  }, [activePiece, nextPiece, grid, level]);

  const moveSide = (dir: number) => {
    if (!activePiece || gameOver || isPaused) return;
    const newPos = { ...activePiece.pos, x: activePiece.pos.x + dir };
    if (!checkCollision(activePiece, newPos)) { setActivePiece({ ...activePiece, pos: newPos }); sounds.playMove(); }
  };

  const rotatePiece = () => {
    if (!activePiece || gameOver || isPaused) return;
    const rotated = activePiece.shape[0].map((_, index) => activePiece.shape.map(col => col[index]).reverse());
    if (!checkCollision(activePiece, activePiece.pos, rotated)) { setActivePiece({ ...activePiece, shape: rotated }); sounds.playRotate(); }
  };

  const startGame = () => {
    setGrid(createGrid());
    setActivePiece(randomPiece());
    setNextPiece(randomPiece());
    setScore(0);
    setLevel(1);
    setGameOver(false);
    setIsPaused(false);
    setGameStarted(true);
    dropIntervalRef.current = INITIAL_DROP_SPEED;
  };

  useEffect(() => {
    const update = (time = 0) => {
      if (isPaused || gameOver || !gameStarted) return;
      const deltaTime = time - lastTimeRef.current;
      lastTimeRef.current = time;
      dropCounterRef.current += deltaTime;
      if (dropCounterRef.current > dropIntervalRef.current) { drop(); dropCounterRef.current = 0; }
      requestRef.current = requestAnimationFrame(update);
    };
    if (gameStarted && !isPaused && !gameOver) requestRef.current = requestAnimationFrame(update);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [gameStarted, isPaused, gameOver, drop]);

  const displayGrid = grid.map(row => [...row]);
  if (activePiece) {
    activePiece.shape.forEach((row, y) => row.forEach((val, x) => {
      if (val !== 0) {
        const gridY = activePiece.pos.y + y;
        const gridX = activePiece.pos.x + x;
        if (gridY >= 0 && gridY < ROWS && gridX >= 0 && gridX < COLS) displayGrid[gridY][gridX] = 1;
      }
    }));
  }

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-4 font-mono select-none overflow-hidden touch-none">
      <div className="relative w-full max-w-[420px] min-h-[740px] bg-[#2d2d2d] border-[8px] border-[#3d3d3d] rounded-[20px] shadow-2xl flex flex-col items-center p-5 gap-4">
        <div className="text-gray-500 text-lg font-bold italic">BRICK GAME 9999 IN 1</div>
        <div className="relative w-full bg-[#111] p-[15px] rounded-[8px] border-[4px] border-[#1a1a1a] flex items-center justify-center">
          <div className="relative w-full h-[400px] bg-[#9bbc0f] border-[4px] border-black/20 rounded-sm overflow-hidden flex">
            <div className="flex-1 grid grid-cols-10 grid-rows-20 border-r-[3px] border-[#0f380f]">
              {displayGrid.map((row, y) => row.map((cell, x) => (
                <div key={`${x}-${y}`} className="p-[1px] border-[1px] border-[#0f380f]/10">
                  <div className={`w-full h-full ${cell !== 0 ? 'bg-[#0f380f]' : 'opacity-5'}`} />
                </div>
              )))}
            </div>
            <div className="w-[80px] p-2 flex flex-col text-[#0f380f] text-[10px] font-bold">
              <div className="mb-4">NEXT: {nextPiece.type}</div>
              <div className="mb-4">SCORE: {score}</div>
              <div className="mb-4">LEVEL: {level}</div>
              {!gameStarted && <button onClick={startGame} className="mt-auto border-2 border-[#0f380f] py-1">START</button>}
              {gameOver && <div className="mt-auto text-red-800">GAME OVER</div>}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          <button onClick={() => moveSide(-1)} className="w-12 h-12 bg-[#555] rounded-full shadow-md text-white">L</button>
          <button onClick={drop} className="w-12 h-12 bg-[#555] rounded-full shadow-md text-white">D</button>
          <button onClick={() => moveSide(1)} className="w-12 h-12 bg-[#555] rounded-full shadow-md text-white">R</button>
          <button onClick={rotatePiece} className="col-start-2 w-12 h-12 bg-[#c0392b] rounded-full shadow-md text-white">ROT</button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, Play, Pause, ChevronDown, ChevronLeft, ChevronRight, RotateCw, Gamepad2 } from 'lucide-react';

// --- Constants ---
const COLS = 10;
const ROWS = 20;
const INITIAL_DROP_SPEED = 800;
const SPEED_INCREMENT = 0.9;
const MIN_SPEED = 100;

// --- Sound Engine ---
class SoundManager {
  private ctx: AudioContext | null = null;

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
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
    freqs.slice(0, lines + 1).forEach((f, i) => {
      setTimeout(() => this.playTone(f, 'square', 0.2, 0.05), i * 100);
    });
  }

  playLevelUp() {
    [440, 554, 659, 880].forEach((f, i) => {
      setTimeout(() => this.playTone(f, 'square', 0.3, 0.05), i * 150);
    });
  }

  playGameOver() {
    const now = this.ctx?.currentTime || 0;
    this.playTone(440, 'sawtooth', 0.5, 0.05);
    setTimeout(() => this.playTone(330, 'sawtooth', 0.5, 0.05), 200);
    setTimeout(() => this.playTone(220, 'sawtooth', 1, 0.05), 400);
  }
}

const sounds = new SoundManager();

const TETROMINOES = {
  I: { shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], color: 'bg-black/80' },
  J: { shape: [[1, 0, 0], [1, 1, 1], [0, 0, 0]], color: 'bg-black/80' },
  L: { shape: [[0, 0, 1], [1, 1, 1], [0, 0, 0]], color: 'bg-black/80' },
  O: { shape: [[1, 1], [1, 1]], color: 'bg-black/80' },
  S: { shape: [[0, 1, 1], [1, 1, 0], [0, 0, 0]], color: 'bg-black/80' },
  T: { shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]], color: 'bg-black/80' },
  Z: { shape: [[1, 1, 0], [0, 1, 1], [0, 0, 0]], color: 'bg-black/80' },
};

type TetrominoKey = keyof typeof TETROMINOES;

interface Piece {
  pos: { x: number; y: number };
  shape: number[][];
  type: TetrominoKey;
}

// --- Utils ---
const createGrid = () => Array.from({ length: ROWS }, () => Array(COLS).fill(0));

const randomPiece = (): Piece => {
  const keys = Object.keys(TETROMINOES) as TetrominoKey[];
  const type = keys[Math.floor(Math.random() * keys.length)];
  return {
    pos: { x: Math.floor(COLS / 2) - 1, y: 0 },
    shape: TETROMINOES[type].shape,
    type,
  };
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

  // --- Game Logic ---
  const checkCollision = (piece: Piece, newPos = piece.pos, newShape = piece.shape) => {
    for (let y = 0; y < newShape.length; y++) {
      for (let x = 0; x < newShape[y].length; x++) {
        if (newShape[y][x] !== 0) {
          const newX = newPos.x + x;
          const newY = newPos.y + y;
          if (
            newX < 0 ||
            newX >= COLS ||
            newY >= ROWS ||
            (newY >= 0 && grid[newY][newX] !== 0)
          ) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const mergePiece = (piece: Piece) => {
    const newGrid = grid.map(row => [...row]);
    piece.shape.forEach((row, y) => {
      row.forEach((val, x) => {
        if (val !== 0) {
          const newY = piece.pos.y + y;
          const newX = piece.pos.x + x;
          if (newY >= 0) newGrid[newY][newX] = 1;
        }
      });
    });
    return newGrid;
  };

  const clearLines = (currentGrid: number[][]) => {
    let linesCleared = 0;
    const newGrid = currentGrid.filter(row => {
      const isFull = row.every(cell => cell !== 0);
      if (isFull) linesCleared++;
      return !isFull;
    });

    while (newGrid.length < ROWS) {
      newGrid.unshift(Array(COLS).fill(0));
    }

    if (linesCleared > 0) {
      sounds.playClear(linesCleared);
      setScore(s => s + [0, 100, 300, 500, 800][linesCleared] * level);
      const totalCleared = (score / 100) + linesCleared;
      if (Math.floor(totalCleared / 10) > level - 1) {
        setLevel(l => l + 1);
        sounds.playLevelUp();
        dropIntervalRef.current = Math.max(MIN_SPEED, dropIntervalRef.current * SPEED_INCREMENT);
      }
    }
    return newGrid;
  };

  const rotate = (matrix: number[][]) => {
    const rotated = matrix[0].map((_, index) => matrix.map(col => col[index]).reverse());
    return rotated;
  };

  const drop = useCallback(() => {
    if (!activePiece) return;
    const newPos = { ...activePiece.pos, y: activePiece.pos.y + 1 };
    if (!checkCollision(activePiece, newPos)) {
      setActivePiece({ ...activePiece, pos: newPos });
    } else {
      // Piece landed
      sounds.playLand();
      if (activePiece.pos.y <= 0) {
        setGameOver(true);
        sounds.playGameOver();
        return;
      }
      const newGrid = mergePiece(activePiece);
      const clearedGrid = clearLines(newGrid);
      setGrid(clearedGrid);
      setActivePiece(nextPiece);
      setNextPiece(randomPiece());
    }
  }, [activePiece, nextPiece, grid, level]);

  const moveSide = (dir: number) => {
    if (!activePiece || gameOver || isPaused) return;
    const newPos = { ...activePiece.pos, x: activePiece.pos.x + dir };
    if (!checkCollision(activePiece, newPos)) {
      setActivePiece({ ...activePiece, pos: newPos });
      sounds.playMove();
    }
  };

  const rotatePiece = () => {
    if (!activePiece || gameOver || isPaused) return;
    const newShape = rotate(activePiece.shape);
    if (!checkCollision(activePiece, activePiece.pos, newShape)) {
      setActivePiece({ ...activePiece, shape: newShape });
      sounds.playRotate();
    }
  };

  const hardDrop = () => {
    if (!activePiece || gameOver || isPaused) return;
    let newY = activePiece.pos.y;
    while (!checkCollision(activePiece, { ...activePiece.pos, y: newY + 1 })) {
      newY++;
    }
    sounds.playLand();
    const finalPiece = { ...activePiece, pos: { ...activePiece.pos, y: newY } };
    const newGrid = mergePiece(finalPiece);
    const clearedGrid = clearLines(newGrid);
    setGrid(clearedGrid);
    setActivePiece(nextPiece);
    setNextPiece(randomPiece());
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
    lastTimeRef.current = 0;
    dropCounterRef.current = 0;
  };

  // --- Loop ---
  useEffect(() => {
    const update = (time = 0) => {
      if (isPaused || gameOver || !gameStarted) return;
      
      const deltaTime = time - lastTimeRef.current;
      lastTimeRef.current = time;
      dropCounterRef.current += deltaTime;

      if (dropCounterRef.current > dropIntervalRef.current) {
        drop();
        dropCounterRef.current = 0;
      }

      requestRef.current = requestAnimationFrame(update);
    };

    if (gameStarted && !isPaused && !gameOver) {
      requestRef.current = requestAnimationFrame(update);
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameStarted, isPaused, gameOver, drop]);

  // --- Keyboard ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!gameStarted) return;
      switch (e.key) {
        case 'ArrowLeft': moveSide(-1); break;
        case 'ArrowRight': moveSide(1); break;
        case 'ArrowDown': drop(); break;
        case 'ArrowUp': rotatePiece(); break;
        case ' ': hardDrop(); break;
        case 'p': setIsPaused(prev => !prev); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePiece, gameOver, isPaused, gameStarted, drop]);

  // --- Render Helpers ---
  const displayGrid = grid.map(row => [...row]);
  if (activePiece) {
    activePiece.shape.forEach((row, y) => {
      row.forEach((val, x) => {
        if (val !== 0) {
          const gridY = activePiece.pos.y + y;
          const gridX = activePiece.pos.x + x;
          if (gridY >= 0 && gridY < ROWS && gridX >= 0 && gridX < COLS) {
            displayGrid[gridY][gridX] = 1;
          }
        }
      });
    });
  }

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-4 font-mono select-none overflow-hidden touch-none">
      {/* Handheld Console Case: Geometric Balance Theme */}
      <div className="relative w-full max-w-[420px] min-h-[740px] bg-[#2d2d2d] border-[8px] border-[#3d3d3d] rounded-[20px] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] flex flex-col items-center p-5 gap-4">
        
        {/* Branding */}
        <div className="w-full flex justify-center items-center mb-2">
          <div className="text-gray-500 text-lg font-bold tracking-tighter italic">BRICK GAME 9999 IN 1</div>
        </div>

        {/* LCD Screen Container (The Bezel) */}
        <div className="relative w-full bg-[#111] p-[15px] rounded-[8px] border-[4px] border-[#1a1a1a] shadow-lg flex items-center justify-center">
          
          {/* Visual Simulation of LCD */}
          <div className="relative w-full h-[400px] bg-[#9bbc0f] border-[4px] border-black/20 border-inset rounded-sm overflow-hidden flex flex-col">
            
            {/* Game Area */}
            <div className="flex-1 flex overflow-hidden">
              <div className="relative flex-1 grid grid-cols-10 grid-rows-20 border-r-[3px] border-[#0f380f] pr-1">
                {displayGrid.map((row, y) => 
                  row.map((cell, x) => (
                    <div 
                      key={`${x}-${y}`} 
                      className={`relative flex items-center justify-center p-[1px]`}
                    >
                      <div className={`w-full h-full border-[2px] border-[#0f380f] ${cell === 0 ? 'opacity-5' : ''}`}>
                         {cell !== 0 && (
                            <div className="w-full h-full bg-[#0f380f]" />
                         )}
                      </div>
                    </div>
                  ))
                )}

                {/* Overlays */}
                <AnimatePresence>
                  {!gameStarted && (
                    <motion.div 
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-[#9bbc0f]/90 flex flex-col items-center justify-center text-[#0f380f] p-4 text-center z-20"
                    >
                      <h1 className="text-2xl font-black mb-4">TETRIS</h1>
                      <button 
                        onClick={startGame}
                        className="px-6 py-2 border-2 border-[#0f380f] font-bold hover:bg-[#0f380f] hover:text-[#9bbc0f] transition-colors"
                      >
                        PLAY
                      </button>
                    </motion.div>
                  )}

                  {gameOver && (
                    <motion.div 
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-[#9bbc0f]/90 flex flex-col items-center justify-center text-[#0f380f] p-4 text-center z-20"
                    >
                      <h1 className="text-xl font-black mb-2 uppercase">Game Over</h1>
                      <div className="text-sm mb-4 border border-[#0f380f] px-2 py-1">SCORE: {score}</div>
                      <button 
                        onClick={startGame}
                        className="px-6 py-2 border-2 border-[#0f380f] font-bold hover:bg-[#0f380f] hover:text-[#9bbc0f] transition-colors"
                      >
                        RETRY
                      </button>
                    </motion.div>
                  )}

                  {isPaused && (
                    <motion.div 
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-[#9bbc0f]/50 flex items-center justify-center text-[#0f380f] z-10"
                    >
                      <div className="text-2xl font-black animate-pulse">PAUSE</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Side Panel */}
              <div className="w-[90px] flex flex-col p-2 gap-4 text-[#0f380f] font-bold uppercase overflow-hidden">
                <div>
                  <div className="text-[10px] mb-1">Next</div>
                  <div className="grid grid-cols-4 grid-rows-4 gap-[1px] w-10 h-10 mx-auto">
                    {Array.from({ length: 4 }).map((_, y) => 
                      Array.from({ length: 4 }).map((_, x) => {
                        const cell = nextPiece.shape[y]?.[x] || 0;
                        return (
                          <div key={`next-${x}-${y}`} className="flex items-center justify-center p-[1px]">
                            <div className={`w-full h-full border-[1.5px] border-[#0f380f] ${cell === 0 ? 'opacity-5' : ''}`}>
                              {cell !== 0 && <div className="w-full h-full bg-[#0f380f]" />}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] mb-1">Score</div>
                  <div className="border-2 border-[#0f380f] p-1 text-[10px] text-center truncate">
                    {score.toString().padStart(6, '0')}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] mb-1">Level</div>
                  <div className="border-2 border-[#0f380f] p-1 text-[10px] text-center">
                    {level.toString().padStart(2, '0')}
                  </div>
                </div>

                <div className="mt-auto text-center opacity-70">
                  <div className="text-[10px]">{isPaused ? 'PAUSED' : ''}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Controls Section */}
        <div className="w-full flex flex-col gap-6 mt-4">
          
          <div className="flex justify-between items-center px-4">
            {/* D-Pad - Styled with btn-gray (#555) */}
            <div className="grid grid-cols-3 grid-rows-3 gap-1">
              <div />
              <div className="flex flex-col items-center">
                <button onClick={rotatePiece} className="w-11 h-11 bg-[#555] rounded-full shadow-[0_4px_0_#333] active:translate-y-1 active:shadow-none flex items-center justify-center group">
                  <ChevronDown className="w-6 h-6 text-gray-400 rotate-180 group-active:scale-90" />
                </button>
                <span className="text-[10px] text-gray-500 font-bold mt-1">UP</span>
              </div>
              <div />
              
              <div className="flex flex-col items-center">
                <button onClick={() => moveSide(-1)} className="w-11 h-11 bg-[#555] rounded-full shadow-[0_4px_0_#333] active:translate-y-1 active:shadow-none flex items-center justify-center group">
                  <ChevronLeft className="w-6 h-6 text-gray-400 group-active:scale-90" />
                </button>
                <span className="text-[10px] text-gray-500 font-bold mt-1">LEFT</span>
              </div>
              <div className="flex flex-col items-center">
                <button onClick={drop} className="w-11 h-11 bg-[#555] rounded-full shadow-[0_4px_0_#333] active:translate-y-1 active:shadow-none flex items-center justify-center group">
                  <ChevronDown className="w-6 h-6 text-gray-400 group-active:scale-90" />
                </button>
                <span className="text-[10px] text-gray-500 font-bold mt-1">DOWN</span>
              </div>
              <div className="flex flex-col items-center">
                <button onClick={() => moveSide(1)} className="w-11 h-11 bg-[#555] rounded-full shadow-[0_4px_0_#333] active:translate-y-1 active:shadow-none flex items-center justify-center group">
                  <ChevronRight className="w-6 h-6 text-gray-400 group-active:scale-90" />
                </button>
                <span className="text-[10px] text-gray-500 font-bold mt-1">RIGHT</span>
              </div>
            </div>

            {/* Action Buttons - Styled with btn (#c0392b) */}
            <div className="flex gap-4">
               <div className="flex flex-col items-center mt-4">
                  <button 
                    onClick={rotatePiece}
                    className="w-15 h-15 bg-[#c0392b] rounded-full shadow-[0_4px_0_#8e1a1a] active:translate-y-1 active:shadow-none flex items-center justify-center"
                  >
                    <RotateCcw className="w-8 h-8 text-white/80" />
                  </button>
                  <span className="text-[10px] text-gray-500 font-bold mt-2">ROTATE</span>
               </div>
               <div className="flex flex-col items-center">
                  <button 
                    onClick={hardDrop}
                    className="w-15 h-15 bg-[#c0392b] rounded-full shadow-[0_4px_0_#8e1a1a] active:translate-y-1 active:shadow-none flex items-center justify-center"
                  >
                    <RotateCw className="w-8 h-8 text-white/80" />
                  </button>
                  <span className="text-[10px] text-gray-500 font-bold mt-2">DROP</span>
               </div>
            </div>
          </div>

          {/* System Buttons */}
          <div className="flex justify-center gap-12 mt-4">
            <div className="flex flex-col items-center">
              <button 
                onClick={() => setIsPaused(p => !p)}
                className="w-5 h-5 bg-gray-600 rounded-full shadow-md active:scale-90"
              />
              <span className="text-[8px] text-gray-600 font-bold mt-1 uppercase">Pause</span>
            </div>
            <div className="flex flex-col items-center">
              <button 
                onClick={startGame}
                className="w-5 h-5 bg-gray-600 rounded-full shadow-md active:scale-90"
              />
              <span className="text-[8px] text-gray-600 font-bold mt-1 uppercase">Reset</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

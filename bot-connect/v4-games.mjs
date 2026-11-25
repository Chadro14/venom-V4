import { randomInt } from 'node:crypto';

const winLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6],
  [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6],
];
const won = (board, mark) => winLines.some(line => line.every(index => board[index] === mark));
const open = board => board.flatMap((mark, index) => mark ? [] : [index]);
const numbered = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function morpion({ args, state }) {
  const input = args.trim().toLowerCase();
  if (!input || input === 'new') state.morpion = Array(9).fill('');
  const board = state.morpion;
  if (!board) return { text: 'Tape .tictactoe pour commencer.' };
  const display = status => {
    const cells = board.map((mark, i) => mark === 'X' ? '❌' : mark === 'O' ? '⭕' : numbered[i]);
    return { text: `*Morpion*\n${[0, 3, 6].map(i => cells.slice(i, i + 3).join(' ')).join('\n')}\n${status}` };
  };
  if (!input || input === 'new') return display('Tape .tictactoe suivi d’un numéro de case.');
  if (!/^[1-9]$/.test(input) || board[Number(input) - 1]) return display('Choisis une case libre de 1 à 9.');
  board[Number(input) - 1] = 'X';
  let result;
  if (won(board, 'X')) result = 'Tu as gagné !';
  else if (open(board).length) {
    const choices = open(board);
    const tactical = mark => choices.find(i => won(board.map((cell, j) => i === j ? mark : cell), mark));
    board[tactical('O') ?? tactical('X') ?? choices[randomInt(choices.length)]] = 'O';
    if (won(board, 'O')) result = 'Venom gagne !';
  }
  if (!result && !open(board).length) result = 'Match nul.';
  if (result) delete state.morpion;
  return display(result ?? 'À toi de jouer.');
}

function bomb({ args, state }) {
  const input = args.trim().toLowerCase();
  if (!input || input === 'new') {
    const mines = new Set();
    while (mines.size < 3) mines.add(randomInt(10));
    state.mines = { mines, opened: new Set(), lives: 3 };
  }
  const game = state.mines;
  if (!game) return { text: 'Tape .playbomb pour commencer.' };
  const display = status => {
    const cells = numbered.map((digit, i) => game.opened.has(i) ? game.mines.has(i) ? '💣' : '✅' : digit);
    return { text: `*Cherche les cases libres*\n${cells.slice(0, 5).join(' ')}\n${cells.slice(5).join(' ')}\n${'❤️'.repeat(game.lives)}\n${status}` };
  };
  if (!input || input === 'new') return display('Tape .playbomb puis un nombre de 1 à 10.');
  const index = Number(input) - 1;
  if (!/^(?:[1-9]|10)$/.test(input) || game.opened.has(index)) return display('Choisis une case encore fermée.');
  game.opened.add(index);
  const hit = game.mines.has(index);
  if (hit) game.lives--;
  if (game.lives === 0 || game.opened.size - (3 - game.lives) === 7) {
    delete state.mines;
    return display(game.lives ? 'Tu as trouvé toutes les cases libres !' : 'Partie terminée.');
  }
  return display(hit ? 'Une bombe !' : 'Case libre.');
}

export const gameCommands = [
  ['tictactoe', { label: 'Morpion contre Venom', run: morpion }],
  ['playbomb', { label: 'Jeu des cases piégées', run: bomb }],
];

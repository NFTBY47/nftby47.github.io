document.addEventListener('DOMContentLoaded', function() {
    const grid = document.getElementById('sudokuGrid');
    const solveBtn = document.getElementById('solveBtn');
    const clearBtn = document.getElementById('clearBtn');
    const modal = document.getElementById('modal');
    const closeModal = document.getElementById('closeModal');
    const virtualKeyboard = document.getElementById('virtualKeyboard');
    const themeToggle = document.getElementById('themeToggle');
    const modalMessage = document.getElementById('modalMessage');
    const htmlElement = document.documentElement;

    const SERVER_URL = 'https://almorozov.pythonanywhere.com';
    const SERVER_TIMEOUT = 5000;
    
    let isSolving = false;
    let activeCell = null;
    let solutionAnimationSpeed = 20;
    let currentTheme = localStorage.getItem('theme') || 'dark';
    let isClearing = false;
    let conflictCheckTimeout = null;
    let currentConflicts = new Map();
    let useServer = true;
    let keyboardVisible = false;

    function shouldShowKeyboard() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        return isMobile || width <= 767;
    }

    function updateKeyboardVisibility() {
        const shouldShow = shouldShowKeyboard();
        
        if (shouldShow) {
            virtualKeyboard.classList.add('show');
            keyboardVisible = true;
            
            const readOnly = window.innerWidth <= 767;
            document.querySelectorAll('.cell-input').forEach(input => {
                input.readOnly = readOnly;
                input.style.caretColor = readOnly ? 'transparent' : '';
            });
            
            console.log(`⌨️ Клавиатура ВКЛ (${window.innerWidth}px)`);
        } else {
            virtualKeyboard.classList.remove('show');
            keyboardVisible = false;
            
            document.querySelectorAll('.cell-input').forEach(input => {
                input.readOnly = false;
                input.style.caretColor = '';
            });
            
            console.log(`⌨️ Клавиатура ВЫКЛ (${window.innerWidth}px)`);
        }
    }

    function setupVirtualKeyboard() {
        virtualKeyboard.querySelectorAll('.number-btn').forEach(btn => {
            btn.addEventListener('click', handleVirtualKeyClick);
            btn.addEventListener('touchstart', function(e) {
                e.preventDefault();
                this.style.transform = 'scale(0.9)';
                this.style.opacity = '0.8';
            });
            btn.addEventListener('touchend', function(e) {
                e.preventDefault();
                this.style.transform = '';
                this.style.opacity = '1';
                const clickEvent = new MouseEvent('click', { view: window, bubbles: true, cancelable: true });
                this.dispatchEvent(clickEvent);
            });
        });
    }

    function handleVirtualKeyClick(e) {
        if (isSolving || isClearing) return;
        e.preventDefault();
        const btn = e.currentTarget;
        const number = btn.dataset.number;
        btn.style.transform = 'scale(0.9)';
        setTimeout(() => { btn.style.transform = ''; }, 150);
        
        if (activeCell) {
            const input = activeCell.querySelector('.cell-input');
            const cellIndex = parseInt(activeCell.dataset.index);
            
            if (number === '0') {
                const oldValue = input.value;
                input.value = '';
                activeCell.classList.remove('user-input', 'solved');
                if (oldValue !== '') setTimeout(async () => { await updateConflicts(cellIndex); }, 50);
            } else {
                const oldValue = input.value;
                input.value = number;
                activeCell.classList.add('user-input');
                activeCell.classList.remove('solved');
                if (oldValue !== number) setTimeout(async () => { await updateConflicts(cellIndex); }, 50);
            }
            
            if (window.innerWidth > 767 && !keyboardVisible) input.focus();
        }
    }

    async function checkServerAvailability() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const response = await fetch(`${SERVER_URL}/health`, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
            clearTimeout(timeoutId);
            if (response.ok) {
                const data = await response.json();
                console.log('✅ Сервер доступен:', data.server);
                useServer = true;
                return true;
            }
        } catch (error) {
            console.warn('⚠️ Сервер недоступен, используется клиентская логика:', error.message);
            useServer = false;
        }
        return false;
    }

    function initTheme() {
        htmlElement.setAttribute('data-theme', currentTheme);
        localStorage.setItem('theme', currentTheme);
        htmlElement.classList.add('theme-transition');
        setTimeout(() => { htmlElement.classList.remove('theme-transition'); }, 300);
    }

    function toggleTheme() {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        initTheme();
        themeToggle.style.transform = 'scale(0.95)';
        setTimeout(() => { themeToggle.style.transform = 'scale(1)'; }, 150);
    }

    function showModal(message = 'Судоку не имеет решения', title = 'Ошибка') {
        modalMessage.textContent = message;
        modal.querySelector('.modal-title').textContent = title;
        modal.style.display = 'block';
    }

    function hideModal() { modal.style.display = 'none'; }

    closeModal.addEventListener('click', hideModal);
    modal.addEventListener('click', function(e) { if (e.target === modal) hideModal(); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && modal.style.display === 'block') hideModal(); });

    function createGrid() {
        grid.innerHTML = '';
        for (let i = 0; i < 81; i++) {
            const cell = document.createElement('div');
            cell.className = 'sudoku-cell';
            cell.dataset.index = i;
            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 1;
            input.className = 'cell-input';
            input.dataset.index = i;
            cell.appendChild(input);
            cell.addEventListener('click', function() { if (!isSolving && !isClearing) handleCellClick(this); });
            input.addEventListener('focus', function() { if (!isSolving && !isClearing) handleCellClick(cell); });
            input.addEventListener('input', function(e) { if (!isSolving && !isClearing) handleCellInput(this, e); });
            input.addEventListener('keydown', function(e) { if (!isSolving && !isClearing) handleCellKeydown(this, e); });
            grid.appendChild(cell);
        }
    }

    function handleCellClick(cell) {
        if (isSolving || isClearing) return;
        document.querySelectorAll('.sudoku-cell').forEach(c => { c.classList.remove('active'); });
        cell.classList.add('active');
        activeCell = cell;
        if (window.innerWidth > 767 || !keyboardVisible) {
            const input = cell.querySelector('.cell-input');
            input.focus();
        }
    }

    function checkCellConflictsClient(cellIndex, board = null) {
        if (!board) board = getBoard();
        const currentValue = board[cellIndex];
        if (currentValue === 0) return [];
        const row = Math.floor(cellIndex / 9);
        const col = cellIndex % 9;
        const conflicts = [];
        for (let c = 0; c < 9; c++) {
            const index = row * 9 + c;
            if (index !== cellIndex && board[index] === currentValue) conflicts.push(index);
        }
        for (let r = 0; r < 9; r++) {
            const index = r * 9 + col;
            if (index !== cellIndex && board[index] === currentValue) conflicts.push(index);
        }
        const startRow = Math.floor(row / 3) * 3;
        const startCol = Math.floor(col / 3) * 3;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const index = (startRow + r) * 9 + (startCol + c);
                if (index !== cellIndex && board[index] === currentValue) conflicts.push(index);
            }
        }
        return conflicts;
    }

    function updateCellAndRelatedConflicts(cellIndex) {
        const board = getBoard();
        const cellsToCheck = new Set();
        cellsToCheck.add(cellIndex);
        const row = Math.floor(cellIndex / 9);
        const col = cellIndex % 9;
        for (let c = 0; c < 9; c++) {
            const index = row * 9 + c;
            if (index !== cellIndex && board[index] !== 0) cellsToCheck.add(index);
        }
        for (let r = 0; r < 9; r++) {
            const index = r * 9 + col;
            if (index !== cellIndex && board[index] !== 0) cellsToCheck.add(index);
        }
        const startRow = Math.floor(row / 3) * 3;
        const startCol = Math.floor(col / 3) * 3;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const index = (startRow + r) * 9 + (startCol + c);
                if (index !== cellIndex && board[index] !== 0) cellsToCheck.add(index);
            }
        }
        for (const index of cellsToCheck) removeCellFromConflicts(index);
        for (const index of cellsToCheck) {
            if (board[index] !== 0) {
                const conflicts = checkCellConflictsClient(index, board);
                if (conflicts.length > 0) {
                    currentConflicts.set(index, conflicts);
                    const cell = grid.children[index];
                    if (cell) cell.classList.add('conflict');
                    for (const conflictIndex of conflicts) {
                        if (currentConflicts.has(conflictIndex)) {
                            const existingConflicts = currentConflicts.get(conflictIndex);
                            if (!existingConflicts.includes(index)) existingConflicts.push(index);
                        } else {
                            currentConflicts.set(conflictIndex, [index]);
                        }
                        const conflictCell = grid.children[conflictIndex];
                        if (conflictCell) conflictCell.classList.add('conflict');
                    }
                }
            }
        }
        cleanupConflicts();
    }

    function removeCellFromConflicts(cellIndex) {
        if (currentConflicts.has(cellIndex)) currentConflicts.delete(cellIndex);
        for (const [index, conflicts] of currentConflicts) {
            const conflictIndex = conflicts.indexOf(cellIndex);
            if (conflictIndex !== -1) conflicts.splice(conflictIndex, 1);
        }
        const cell = grid.children[cellIndex];
        if (cell) cell.classList.remove('conflict');
    }

    function cleanupConflicts() {
        for (const [index, conflicts] of currentConflicts) {
            if (conflicts.length === 0) currentConflicts.delete(index);
        }
        for (let i = 0; i < 81; i++) {
            if (!currentConflicts.has(i)) {
                let hasConflict = false;
                for (const [, conflicts] of currentConflicts) {
                    if (conflicts.includes(i)) {
                        hasConflict = true;
                        break;
                    }
                }
                if (!hasConflict) {
                    const cell = grid.children[i];
                    if (cell) cell.classList.remove('conflict');
                }
            }
        }
    }

    async function checkConflictsOnServer(board) {
        if (!useServer) return null;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), SERVER_TIMEOUT);
            const response = await fetch(`${SERVER_URL}/check_conflicts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ board: board }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (response.ok) return await response.json();
        } catch (error) { console.warn('Не удалось проверить конфликты на сервере'); }
        return null;
    }

    async function solveOnServer(board) {
        if (!useServer) return null;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), SERVER_TIMEOUT);
            const response = await fetch(`${SERVER_URL}/solve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ board: board }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (response.ok) return await response.json();
        } catch (error) { console.warn('Не удалось решить на сервере'); }
        return null;
    }

    async function updateConflicts(cellIndex) {
        const board = getBoard();
        if (useServer) {
            const serverResult = await checkConflictsOnServer(board);
            if (serverResult && !serverResult.error) {
                currentConflicts.clear();
                document.querySelectorAll('.sudoku-cell').forEach(cell => { cell.classList.remove('conflict'); });
                if (serverResult.conflicts && serverResult.conflicts.length > 0) {
                    serverResult.conflicts.forEach(conflictIndex => {
                        const cell = grid.children[conflictIndex];
                        if (cell) cell.classList.add('conflict');
                    });
                    for (const conflictIndex of serverResult.conflicts) {
                        const conflicts = checkCellConflictsClient(conflictIndex, board);
                        if (conflicts.length > 0) currentConflicts.set(conflictIndex, conflicts);
                    }
                }
                return;
            }
        }
        updateCellAndRelatedConflicts(cellIndex);
    }

    function handleCellInput(input, e) {
        if (!/^[1-9]?$/.test(input.value)) input.value = '';
        else {
            input.parentElement.classList.add('user-input');
            input.parentElement.classList.remove('solved');
        }
        if (conflictCheckTimeout) clearTimeout(conflictCheckTimeout);
        conflictCheckTimeout = setTimeout(async () => {
            const cellIndex = parseInt(input.parentElement.dataset.index);
            await updateConflicts(cellIndex);
            conflictCheckTimeout = null;
        }, 100);
    }

    function handleCellKeydown(input, e) {
        if (keyboardVisible && window.innerWidth <= 767) {
            e.preventDefault();
            return;
        }
        const cell = input.parentElement;
        const index = parseInt(cell.dataset.index);
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const oldValue = input.value;
            setTimeout(async () => {
                if (input.value === '') {
                    cell.classList.remove('user-input', 'solved');
                    if (oldValue !== '') await updateConflicts(index);
                }
            }, 0);
        }
        if (!keyboardVisible && e.key.startsWith('Arrow')) {
            e.preventDefault();
            navigateGrid(e.key, index);
        }
        if (!keyboardVisible && /^[1-9]$/.test(e.key)) {
            e.preventDefault();
            const oldValue = input.value;
            input.value = e.key;
            cell.classList.add('user-input');
            cell.classList.remove('solved');
            setTimeout(async () => { await updateConflicts(index); }, 50);
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            solveSudoku();
        }
    }

    function navigateGrid(direction, currentIndex) {
        let newIndex = currentIndex;
        switch(direction) {
            case 'ArrowUp': newIndex = currentIndex - 9; if (newIndex < 0) newIndex += 81; break;
            case 'ArrowDown': newIndex = currentIndex + 9; if (newIndex >= 81) newIndex -= 81; break;
            case 'ArrowLeft': newIndex = currentIndex - 1; if (Math.floor(newIndex / 9) !== Math.floor(currentIndex / 9)) newIndex = currentIndex + 8; break;
            case 'ArrowRight': newIndex = currentIndex + 1; if (Math.floor(newIndex / 9) !== Math.floor(currentIndex / 9)) newIndex = currentIndex - 8; break;
        }
        if (newIndex >= 0 && newIndex < 81) {
            const newCell = grid.children[newIndex];
            handleCellClick(newCell);
            const input = newCell.querySelector('.cell-input');
            if (window.innerWidth > 767) input.focus();
        }
    }

    function getBoard() {
        const board = [];
        for (let i = 0; i < 81; i++) {
            const cell = grid.children[i];
            const input = cell.querySelector('.cell-input');
            board.push(input.value === '' ? 0 : parseInt(input.value));
        }
        return board;
    }

    class SudokuSolverClient {
        constructor(board) { this.board = board; }
        isValid(board, row, col, num) {
            for (let x = 0; x < 9; x++) if (board[row * 9 + x] === num) return false;
            for (let y = 0; y < 9; y++) if (board[y * 9 + col] === num) return false;
            const startRow = Math.floor(row / 3) * 3;
            const startCol = Math.floor(col / 3) * 3;
            for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (board[(startRow + i) * 9 + (startCol + j)] === num) return false;
            return true;
        }
        findEmpty(board) {
            for (let i = 0; i < 81; i++) if (board[i] === 0) return { row: Math.floor(i / 9), col: i % 9, index: i };
            return null;
        }
        solveSudoku(board) {
            const empty = this.findEmpty(board);
            if (!empty) return true;
            const { row, col, index } = empty;
            for (let num = 1; num <= 9; num++) {
                if (this.isValid(board, row, col, num)) {
                    board[index] = num;
                    if (this.solveSudoku(board)) return true;
                    board[index] = 0;
                }
            }
            return false;
        }
        solve() {
            const boardCopy = [...this.board];
            const hasConflicts = this.hasConflicts(boardCopy);
            if (hasConflicts) return { solved: false, board: null, message: 'Некорректное судоку: есть конфликты' };
            const isSolved = this.solveSudoku(boardCopy);
            return { solved: isSolved, board: isSolved ? boardCopy : null, message: isSolved ? 'Судоку решено' : 'Судоку не имеет решения', server: 'javascript' };
        }
        hasConflicts(board) {
            for (let i = 0; i < 81; i++) {
                if (board[i] !== 0) {
                    const row = Math.floor(i / 9);
                    const col = i % 9;
                    const num = board[i];
                    board[i] = 0;
                    if (!this.isValid(board, row, col, num)) { board[i] = num; return true; }
                    board[i] = num;
                }
            }
            return false;
        }
    }

    async function animateSolution(solutionBoard, source = 'javascript') {
        const originalBoard = getBoard();
        document.querySelectorAll('.sudoku-cell').forEach(cell => { cell.classList.remove('conflict'); });
        currentConflicts.clear();
        const cellsToSolve = [];
        for (let i = 0; i < 81; i++) {
            if (originalBoard[i] === 0 && solutionBoard[i] !== 0) {
                const cell = grid.children[i];
                const row = Math.floor(i / 9);
                const col = i % 9;
                const distance = Math.sqrt(Math.pow(row - 4, 2) + Math.pow(col - 4, 2));
                cellsToSolve.push({ cell: cell, index: i, distance: distance });
            }
        }
        cellsToSolve.sort((a, b) => a.distance - b.distance);
        for (let i = 0; i < cellsToSolve.length; i++) {
            if (!isSolving || isClearing) {
                console.log('Анимация прервана');
                return;
            }
            const { cell, index } = cellsToSolve[i];
            const input = cell.querySelector('.cell-input');
            await new Promise(resolve => setTimeout(resolve, solutionAnimationSpeed));
            input.value = solutionBoard[index];
            cell.classList.add('solved');
            cell.classList.remove('user-input', 'conflict');
        }
        console.log(`✅ Судоку решено (${source})`);
    }

    async function solveSudoku() {
        if (isSolving) return;
        if (currentConflicts.size > 0) {
            showModal('Исправьте конфликты перед решением!', 'Конфликты обнаружены');
            return;
        }
        const originalBoard = getBoard();
        const hasInput = originalBoard.some(cell => cell !== 0);
        if (!hasInput) {
            showModal('Введите хотя бы одну цифру в судоку!', 'Внимание');
            return;
        }
        isSolving = true;
        solveBtn.disabled = true;
        solveBtn.textContent = 'Решаем...';
        let solvedBy = 'javascript';
        let solution = null;
        try {
            if (useServer) {
                console.log('🌐 Попытка решения на сервере...');
                const serverResult = await solveOnServer(originalBoard);
                if (serverResult && !serverResult.error && serverResult.solved) {
                    solution = serverResult.board;
                    solvedBy = serverResult.server || 'python';
                    console.log(`✅ Сервер решил`);
                }
            }
            if (!solution) {
                console.log('💻 Используем клиентский решатель...');
                const solver = new SudokuSolverClient(originalBoard);
                const clientResult = solver.solve();
                if (clientResult.solved) {
                    solution = clientResult.board;
                    solvedBy = clientResult.server || 'javascript';
                } else {
                    showModal(clientResult.message, 'Ошибка');
                    isSolving = false;
                    solveBtn.disabled = false;
                    solveBtn.textContent = 'Решить';
                    return;
                }
            }
            await animateSolution(solution, solvedBy);
        } catch (error) {
            console.error('❌ Ошибка при решении:', error);
            showModal('Произошла ошибка при решении судоку', 'Ошибка');
        } finally {
            isSolving = false;
            solveBtn.disabled = false;
            solveBtn.textContent = 'Решить';
        }
    }

    function clearGrid() {
        if (isSolving) {
            console.log('Идет решение, очистка игнорируется');
            return;
        }
        isClearing = true;
        for (let i = 0; i < 81; i++) {
            const cell = grid.children[i];
            const input = cell.querySelector('.cell-input');
            input.value = '';
            cell.classList.remove('user-input', 'solved', 'active', 'conflict');
        }
        activeCell = null;
        currentConflicts.clear();
        setTimeout(() => {
            if (grid.children[0]) handleCellClick(grid.children[0]);
            isClearing = false;
        }, 50);
    }

    solveBtn.addEventListener('click', solveSudoku);
    clearBtn.addEventListener('click', clearGrid);
    themeToggle.addEventListener('click', toggleTheme);

    async function init() {
        createGrid();
        setupVirtualKeyboard();
        initTheme();
        updateKeyboardVisibility();
        window.addEventListener('resize', updateKeyboardVisibility);
        window.addEventListener('orientationchange', function() { setTimeout(updateKeyboardVisibility, 100); });
        console.log('🚀 Инициализация SUDO.RESH...');
        await checkServerAvailability();
        setTimeout(() => { if (grid.children[0]) handleCellClick(grid.children[0]); }, 100);
        console.log('✅ SUDO.RESH инициализирован');
        console.log(`🔧 Режим: ${useServer ? 'Серверный' : 'Клиентский'}`);
    }

    init();

    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'r') { e.preventDefault(); if (!isSolving) clearGrid(); }
        if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); solveSudoku(); }
        if (e.ctrlKey && e.key === 't') { e.preventDefault(); toggleTheme(); }
    });

    window.sudokuApp = { getBoard, clearGrid, solveSudoku, toggleTheme, checkServerAvailability, currentTheme: () => currentTheme, usingServer: () => useServer, keyboardVisible: () => keyboardVisible };
});

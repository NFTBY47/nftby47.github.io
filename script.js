document.addEventListener('DOMContentLoaded', function() {
    // Элементы DOM
    const grid = document.getElementById('sudokuGrid');
    const solveBtn = document.getElementById('solveBtn');
    const clearBtn = document.getElementById('clearBtn');
    const modal = document.getElementById('modal');
    const closeModal = document.getElementById('closeModal');
    const virtualKeyboard = document.getElementById('virtualKeyboard');
    const themeToggle = document.getElementById('themeToggle');
    const modalMessage = document.getElementById('modalMessage');
    const htmlElement = document.documentElement;

    // Константы
    const SERVER_URL = 'https://almorozov.pythonanywhere.com';
    const SERVER_TIMEOUT = 5000;
    
    // Состояние приложения
    let isSolving = false;
    let activeCell = null;
    let currentTheme = localStorage.getItem('theme') || 'dark';
    let currentConflicts = new Map();
    let useServer = true;
    let isMobile = false;

    // Функция определения устройства
    function detectDeviceType() {
        const width = window.innerWidth;
        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        const userAgent = navigator.userAgent.toLowerCase();
        const isRealMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
        
        // Это мобильное устройство если:
        // 1. Ширина экрана <= 767 И (есть тач-экран ИЛИ это реальное мобильное устройство)
        return (width <= 767) && (isTouchDevice || isRealMobile);
    }

    // Проверка доступности сервера
    async function checkServerAvailability() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const response = await fetch(`${SERVER_URL}/health`, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            clearTimeout(timeoutId);
            
            if (response.ok) {
                useServer = true;
                console.log('✅ Сервер доступен');
                return true;
            }
        } catch (error) {
            console.warn('⚠️ Сервер недоступен, используется клиентская логика');
            useServer = false;
        }
        return false;
    }

    // Инициализация темы
    function initTheme() {
        htmlElement.setAttribute('data-theme', currentTheme);
        localStorage.setItem('theme', currentTheme);
        themeToggle.textContent = currentTheme === 'dark' ? '🌙' : '☀️';
    }

    // Переключение темы
    function toggleTheme() {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        initTheme();
        themeToggle.style.transform = 'scale(0.9)';
        setTimeout(() => themeToggle.style.transform = 'scale(1)', 150);
    }

    // Показать модальное окно
    function showModal(message = 'Судоку не имеет решения', title = 'Ошибка') {
        modalMessage.textContent = message;
        modal.querySelector('.modal-title').textContent = title;
        modal.classList.add('show');
    }

    // Скрыть модальное окно
    function hideModal() {
        modal.classList.remove('show');
    }

    // Создание сетки
    function createGrid() {
        grid.innerHTML = '';
        
        for (let i = 0; i < 81; i++) {
            const cell = document.createElement('div');
            cell.className = 'sudoku-cell';
            cell.dataset.index = i;
            
            const input = document.createElement('input');
            input.type = 'text';
            input.inputMode = 'none';
            input.maxLength = 1;
            input.className = 'cell-input';
            input.dataset.index = i;
            input.autocomplete = 'off';
            input.autocorrect = 'off';
            input.autocapitalize = 'off';
            input.spellcheck = false;
            
            cell.appendChild(input);
            
            // Обработчики для всех устройств
            cell.addEventListener('click', () => handleCellClick(cell));
            input.addEventListener('focus', () => handleCellClick(cell));
            input.addEventListener('input', (e) => handleCellInput(e.target));
            input.addEventListener('keydown', (e) => handleCellKeydown(e.target, e));
            
            grid.appendChild(cell);
        }
    }

    // Обработчик клика по ячейке (ИСПРАВЛЕННАЯ ВЕРСИЯ)
    function handleCellClick(cell) {
        if (isSolving) return;
        
        document.querySelectorAll('.sudoku-cell').forEach(c => {
            c.classList.remove('active');
        });
        
        cell.classList.add('active');
        activeCell = cell;
        
        // На ПК всегда фокусируемся на input
        if (!isMobile) {
            const input = cell.querySelector('.cell-input');
            input.focus();
        }
    }

    // Обработчик ввода в ячейку
    function handleCellInput(input) {
        if (isSolving) return;
        
        if (!/^[1-9]?$/.test(input.value)) {
            input.value = '';
        } else if (input.value !== '') {
            input.parentElement.classList.add('user-input');
            input.parentElement.classList.remove('solved', 'solved-animation');
        }
        
        setTimeout(() => checkConflicts(), 50);
    }

    // Обработчик нажатия клавиш
    function handleCellKeydown(input, e) {
        if (isSolving) return;
        
        const index = parseInt(input.parentElement.dataset.index);
        
        if (e.key.startsWith('Arrow')) {
            e.preventDefault();
            navigateGrid(e.key, index);
        }
        
        if (/^[1-9]$/.test(e.key)) {
            e.preventDefault();
            input.value = e.key;
            input.parentElement.classList.add('user-input');
            input.parentElement.classList.remove('solved', 'solved-animation');
            setTimeout(() => checkConflicts(), 50);
        }
        
        if (e.key === 'Backspace' || e.key === 'Delete') {
            input.value = '';
            input.parentElement.classList.remove('user-input', 'solved', 'solved-animation');
            setTimeout(() => checkConflicts(), 50);
        }
        
        if (e.key === 'Enter') {
            e.preventDefault();
            solveSudoku();
        }
        
        if (e.key === 'Escape') {
            if (activeCell) {
                activeCell.classList.remove('active');
                activeCell = null;
            }
        }
    }

    // Навигация по сетке
    function navigateGrid(direction, currentIndex) {
        let newIndex = currentIndex;
        
        switch(direction) {
            case 'ArrowUp': newIndex = currentIndex - 9; if (newIndex < 0) newIndex += 81; break;
            case 'ArrowDown': newIndex = currentIndex + 9; if (newIndex >= 81) newIndex -= 81; break;
            case 'ArrowLeft': 
                newIndex = currentIndex - 1; 
                if (Math.floor(newIndex / 9) !== Math.floor(currentIndex / 9)) newIndex = currentIndex + 8; 
                break;
            case 'ArrowRight': 
                newIndex = currentIndex + 1; 
                if (Math.floor(newIndex / 9) !== Math.floor(currentIndex / 9)) newIndex = currentIndex - 8; 
                break;
        }
        
        if (newIndex >= 0 && newIndex < 81) {
            const newCell = grid.children[newIndex];
            handleCellClick(newCell);
            if (!isMobile) newCell.querySelector('.cell-input').focus();
        }
    }

    // Получение текущего состояния доски
    function getBoard() {
        const board = [];
        for (let i = 0; i < 81; i++) {
            const cell = grid.children[i];
            const input = cell.querySelector('.cell-input');
            const value = input.value.trim();
            board.push(value === '' ? 0 : parseInt(value, 10));
        }
        return board;
    }

    // Проверка валидности числа
    function isValid(board, row, col, num) {
        for (let x = 0; x < 9; x++) if (board[row * 9 + x] === num) return false;
        for (let y = 0; y < 9; y++) if (board[y * 9 + col] === num) return false;
        
        const startRow = Math.floor(row / 3) * 3;
        const startCol = Math.floor(col / 3) * 3;
        for (let i = 0; i < 3; i++) 
            for (let j = 0; j < 3; j++) 
                if (board[(startRow + i) * 9 + (startCol + j)] === num) return false;
        
        return true;
    }

    // Проверка конфликтов
    function checkConflicts() {
        const board = getBoard();
        currentConflicts.clear();
        
        document.querySelectorAll('.sudoku-cell').forEach(cell => {
            cell.classList.remove('conflict');
        });
        
        // Проверяем строки
        for (let row = 0; row < 9; row++) {
            const seen = new Set();
            for (let col = 0; col < 9; col++) {
                const index = row * 9 + col;
                const value = board[index];
                if (value !== 0 && seen.has(value)) {
                    for (let c = 0; c < 9; c++) {
                        const idx = row * 9 + c;
                        if (board[idx] === value) {
                            currentConflicts.set(idx, true);
                            grid.children[idx].classList.add('conflict');
                        }
                    }
                }
                seen.add(value);
            }
        }
        
        // Проверяем столбцы
        for (let col = 0; col < 9; col++) {
            const seen = new Set();
            for (let row = 0; row < 9; row++) {
                const index = row * 9 + col;
                const value = board[index];
                if (value !== 0 && seen.has(value)) {
                    for (let r = 0; r < 9; r++) {
                        const idx = r * 9 + col;
                        if (board[idx] === value) {
                            currentConflicts.set(idx, true);
                            grid.children[idx].classList.add('conflict');
                        }
                    }
                }
                seen.add(value);
            }
        }
        
        // Проверяем блоки 3x3
        for (let blockRow = 0; blockRow < 3; blockRow++) {
            for (let blockCol = 0; blockCol < 3; blockCol++) {
                const seen = new Set();
                for (let i = 0; i < 3; i++) {
                    for (let j = 0; j < 3; j++) {
                        const row = blockRow * 3 + i;
                        const col = blockCol * 3 + j;
                        const index = row * 9 + col;
                        const value = board[index];
                        
                        if (value !== 0 && seen.has(value)) {
                            for (let x = 0; x < 3; x++) {
                                for (let y = 0; y < 3; y++) {
                                    const r = blockRow * 3 + x;
                                    const c = blockCol * 3 + y;
                                    const idx = r * 9 + c;
                                    if (board[idx] === value) {
                                        currentConflicts.set(idx, true);
                                        grid.children[idx].classList.add('conflict');
                                    }
                                }
                            }
                        }
                        seen.add(value);
                    }
                }
            }
        }
    }

    // Настройка виртуальной клавиатуры
    function setupVirtualKeyboard() {
        const buttons = virtualKeyboard.querySelectorAll('.number-btn, .clear-cell-btn');
        
        buttons.forEach(btn => {
            // Клонируем кнопку для удаления старых обработчиков
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            // Обработчик click для всех устройств
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleVirtualKeyPress(newBtn);
                
                // Визуальная обратная связь
                newBtn.style.transform = 'scale(0.94)';
                newBtn.style.opacity = '0.9';
                setTimeout(() => {
                    newBtn.style.transform = '';
                    newBtn.style.opacity = '1';
                }, 150);
            });
            
            // Для мобильных устройств добавляем touch события
            if (isMobile) {
                newBtn.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleVirtualKeyPress(newBtn);
                    newBtn.style.transform = 'scale(0.94)';
                    newBtn.style.opacity = '0.9';
                }, { passive: false });
                
                newBtn.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    newBtn.style.transform = '';
                    newBtn.style.opacity = '1';
                }, { passive: false });
                
                newBtn.addEventListener('touchcancel', (e) => {
                    e.preventDefault();
                    newBtn.style.transform = '';
                    newBtn.style.opacity = '1';
                }, { passive: false });
                
                newBtn.addEventListener('contextmenu', (e) => e.preventDefault());
            }
        });
    }

    // Обработчик нажатия на виртуальную клавиатуру
    function handleVirtualKeyPress(btn) {
        if (isSolving) return;
        
        const number = btn.dataset.number;
        
        if (!activeCell) {
            const firstCell = grid.children[0];
            if (firstCell) {
                handleCellClick(firstCell);
            }
        }
        
        if (activeCell) {
            const input = activeCell.querySelector('.cell-input');
            
            if (number === '0') {
                input.value = '';
                activeCell.classList.remove('user-input', 'solved', 'solved-animation');
            } else {
                input.value = number;
                activeCell.classList.add('user-input');
                activeCell.classList.remove('solved', 'solved-animation');
            }
            
            setTimeout(() => checkConflicts(), 50);
        } else {
            showModal('Сначала выберите ячейку тапом', 'Подсказка');
        }
    }

    // Обновление видимости клавиатуры (ИСПРАВЛЕННАЯ ВЕРСИЯ)
    function updateKeyboardVisibility() {
        isMobile = detectDeviceType();
        
        if (isMobile) {
            // Реальное мобильное устройство
            virtualKeyboard.classList.add('show');
            document.querySelectorAll('.cell-input').forEach(input => {
                input.readOnly = false;
                input.inputMode = 'numeric';
            });
            
            setTimeout(() => setupVirtualKeyboard(), 100);
        } else {
            // ПК (даже с узким экраном)
            virtualKeyboard.classList.remove('show');
            document.querySelectorAll('.cell-input').forEach(input => {
                input.readOnly = false;
                input.inputMode = 'numeric';
            });
        }
    }

    // Решение судоку
    async function solveSudoku() {
        if (isSolving) return;
        
        if (currentConflicts.size > 0) {
            showModal('Исправьте конфликты перед решением!', 'Конфликты обнаружены');
            return;
        }
        
        const board = getBoard();
        const hasInput = board.some(cell => cell !== 0);
        
        if (!hasInput) {
            showModal('Введите хотя бы одну цифру в судоку!', 'Внимание');
            return;
        }
        
        isSolving = true;
        solveBtn.disabled = true;
        solveBtn.textContent = 'Решаем...';
        
        try {
            let solution = null;
            let solvedBy = 'javascript';
            
            if (useServer) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), SERVER_TIMEOUT);
                    
                    const response = await fetch(`${SERVER_URL}/solve`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ board: board }),
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (response.ok) {
                        const result = await response.json();
                        if (result.solved && result.board) {
                            solution = result.board;
                            solvedBy = result.server || 'python';
                        }
                    }
                } catch (error) {
                    console.log('⚠️ Не удалось решить на сервере');
                }
            }
            
            if (!solution) {
                const clientSolution = solveClient(board);
                if (clientSolution.solved) {
                    solution = clientSolution.board;
                } else {
                    showModal(clientSolution.message, 'Ошибка');
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

    // Клиентский решатель
    function solveClient(board) {
        const boardCopy = [...board];
        
        for (let i = 0; i < 81; i++) {
            if (boardCopy[i] !== 0) {
                const row = Math.floor(i / 9);
                const col = i % 9;
                const num = boardCopy[i];
                boardCopy[i] = 0;
                
                if (!isValid(boardCopy, row, col, num)) {
                    return { solved: false, message: 'Некорректное судоку' };
                }
                
                boardCopy[i] = num;
            }
        }
        
        const solved = solveSudokuRecursive(boardCopy);
        
        return {
            solved: solved,
            board: solved ? boardCopy : null,
            message: solved ? 'Судоку решено' : 'Судоку не имеет решения'
        };
    }

    // Рекурсивное решение
    function solveSudokuRecursive(board) {
        let emptyIndex = -1;
        for (let i = 0; i < 81; i++) {
            if (board[i] === 0) {
                emptyIndex = i;
                break;
            }
        }
        
        if (emptyIndex === -1) return true;
        
        const row = Math.floor(emptyIndex / 9);
        const col = emptyIndex % 9;
        
        for (let num = 1; num <= 9; num++) {
            if (isValid(board, row, col, num)) {
                board[emptyIndex] = num;
                
                if (solveSudokuRecursive(board)) {
                    return true;
                }
                
                board[emptyIndex] = 0;
            }
        }
        
        return false;
    }

    // Анимация решения
    async function animateSolution(solution, source = 'javascript') {
        const originalBoard = getBoard();
        
        // Собираем ячейки для заполнения
        const cellsToSolve = [];
        for (let i = 0; i < 81; i++) {
            if (originalBoard[i] === 0 && solution[i] !== 0) {
                const cell = grid.children[i];
                const row = Math.floor(i / 9);
                const col = i % 9;
                const distanceFromCenter = Math.sqrt(
                    Math.pow(row - 4, 2) + Math.pow(col - 4, 2)
                );
                cellsToSolve.push({ 
                    cell: cell, 
                    index: i, 
                    distance: distanceFromCenter 
                });
            }
        }
        
        cellsToSolve.sort((a, b) => a.distance - b.distance);
        
        for (let i = 0; i < cellsToSolve.length; i++) {
            if (!isSolving) break;
            
            const { cell, index } = cellsToSolve[i];
            const input = cell.querySelector('.cell-input');
            
            await new Promise(resolve => setTimeout(resolve, 35));
            
            input.value = solution[index];
            cell.classList.remove('user-input', 'conflict');
            cell.classList.add('solved', 'solved-animation');
        }
        
        console.log(`✅ Судоку решено (${source})`);
    }

    // Очистка сетки
    function clearGrid() {
        if (isSolving) return;
        
        for (let i = 0; i < 81; i++) {
            const cell = grid.children[i];
            const input = cell.querySelector('.cell-input');
            
            input.value = '';
            cell.classList.remove('user-input', 'solved', 'solved-animation', 'active', 'conflict');
        }
        
        activeCell = null;
        currentConflicts.clear();
        
        setTimeout(() => {
            if (grid.children[0]) handleCellClick(grid.children[0]);
        }, 50);
    }

    // Инициализация приложения
    async function init() {
        createGrid();
        setupVirtualKeyboard();
        initTheme();
        updateKeyboardVisibility();
        
        solveBtn.addEventListener('click', solveSudoku);
        clearBtn.addEventListener('click', clearGrid);
        themeToggle.addEventListener('click', toggleTheme);
        closeModal.addEventListener('click', hideModal);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideModal();
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('show')) {
                hideModal();
            }
            
            if (e.ctrlKey && !modal.classList.contains('show')) {
                switch(e.key) {
                    case 'r':
                        e.preventDefault();
                        if (!isSolving) clearGrid();
                        break;
                    case 'Enter':
                        e.preventDefault();
                        if (!isSolving) solveSudoku();
                        break;
                    case 't':
                        e.preventDefault();
                        toggleTheme();
                        break;
                }
            }
        });
        
        window.addEventListener('resize', updateKeyboardVisibility);
        window.addEventListener('orientationchange', () => {
            setTimeout(updateKeyboardVisibility, 100);
        });
        
        await checkServerAvailability();
        
        setTimeout(() => {
            if (grid.children[0]) handleCellClick(grid.children[0]);
        }, 100);
        
        console.log('🚀 SUDO.RESH запущен');
        console.log(`🔧 Режим: ${useServer ? 'Серверный' : 'Клиентский'}`);
        console.log(`📱 Устройство: ${isMobile ? 'Мобильное' : 'Десктоп'}`);
    }

    // Запуск
    init();
});

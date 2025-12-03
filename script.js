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

    // ============ КОНФИГУРАЦИЯ ============
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

    // ============ ВИРТУАЛЬНАЯ КЛАВИАТУРА ============

    // Проверяем, нужно ли показывать клавиатуру
    function shouldShowKeyboard() {
        const width = window.innerWidth;
        // Показываем на мобильных и узких экранах
        return width <= 1200;
    }

    // Показываем/скрываем клавиатуру
    function updateKeyboardVisibility() {
        const shouldShow = shouldShowKeyboard();
        
        if (shouldShow) {
            virtualKeyboard.classList.add('show');
            keyboardVisible = true;
            
            // На мобильных устройствах делаем input только для чтения
            if (window.innerWidth <= 767) {
                document.querySelectorAll('.cell-input').forEach(input => {
                    input.readOnly = true;
                    input.style.caretColor = 'transparent';
                });
            }
            
            console.log(`⌨️ Виртуальная клавиатура: ВКЛ (${window.innerWidth}px)`);
        } else {
            virtualKeyboard.classList.remove('show');
            keyboardVisible = false;
            
            // Включаем редактирование на десктопах
            document.querySelectorAll('.cell-input').forEach(input => {
                input.readOnly = false;
                input.style.caretColor = '';
            });
            
            console.log(`⌨️ Виртуальная клавиатура: ВЫКЛ (${window.innerWidth}px)`);
        }
    }

    // Настраиваем виртуальную клавиатуру
    function setupVirtualKeyboard() {
        // Вешаем обработчики на все кнопки клавиатуры
        virtualKeyboard.querySelectorAll('.number-btn').forEach(btn => {
            btn.addEventListener('click', handleVirtualKeyClick);
            btn.addEventListener('touchstart', function(e) {
                e.preventDefault();
                this.style.transform = 'scale(0.9)';
            });
            btn.addEventListener('touchend', function(e) {
                e.preventDefault();
                this.style.transform = '';
                const clickEvent = new MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true
                });
                this.dispatchEvent(clickEvent);
            });
        });
    }

    // Обработчик клика по кнопке клавиатуры
    function handleVirtualKeyClick(e) {
        if (isSolving || isClearing) return;
        
        e.preventDefault();
        const btn = e.currentTarget;
        const number = btn.dataset.number;
        
        // Анимация нажатия
        btn.style.transform = 'scale(0.9)';
        setTimeout(() => {
            btn.style.transform = '';
        }, 150);
        
        if (activeCell) {
            const input = activeCell.querySelector('.cell-input');
            const cellIndex = parseInt(activeCell.dataset.index);
            
            if (number === '0') {
                // Очистка
                const oldValue = input.value;
                input.value = '';
                activeCell.classList.remove('user-input', 'solved');
                
                // Если было значение, обновляем конфликты
                if (oldValue !== '') {
                    setTimeout(async () => {
                        await updateConflicts(cellIndex);
                    }, 50);
                }
            } else {
                // Ввод цифры
                const oldValue = input.value;
                input.value = number;
                activeCell.classList.add('user-input');
                activeCell.classList.remove('solved');
                
                // Если значение изменилось, обновляем конфликты
                if (oldValue !== number) {
                    setTimeout(async () => {
                        await updateConflicts(cellIndex);
                    }, 50);
                }
            }
            
            // Фокус обратно только на десктопах
            if (window.innerWidth > 767 && !keyboardVisible) {
                input.focus();
            }
        }
    }

    // ============ ОСНОВНЫЕ ФУНКЦИИ ============

    // Проверка доступности сервера
    async function checkServerAvailability() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            
            const response = await fetch(`${SERVER_URL}/health`, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json'
                }
            });
            
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

    // Инициализация темы
    function initTheme() {
        htmlElement.setAttribute('data-theme', currentTheme);
        localStorage.setItem('theme', currentTheme);
        
        htmlElement.classList.add('theme-transition');
        setTimeout(() => {
            htmlElement.classList.remove('theme-transition');
        }, 300);
    }

    // Переключение темы
    function toggleTheme() {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        initTheme();
        
        themeToggle.style.transform = 'scale(0.95)';
        setTimeout(() => {
            themeToggle.style.transform = 'scale(1)';
        }, 150);
    }

    // Функции для модального окна
    function showModal(message = 'Судоку не имеет решения', title = 'Ошибка') {
        modalMessage.textContent = message;
        modal.querySelector('.modal-title').textContent = title;
        modal.style.display = 'block';
    }

    function hideModal() {
        modal.style.display = 'none';
    }

    // Закрытие модального окна
    closeModal.addEventListener('click', hideModal);
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            hideModal();
        }
    });
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && modal.style.display === 'block') {
            hideModal();
        }
    });

    // Создаём сетку
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
            
            // Обработчики событий
            cell.addEventListener('click', function() {
                if (!isSolving && !isClearing) {
                    handleCellClick(this);
                }
            });
            
            input.addEventListener('focus', function() {
                if (!isSolving && !isClearing) {
                    handleCellClick(cell);
                }
            });
            
            input.addEventListener('input', function(e) {
                if (!isSolving && !isClearing) {
                    handleCellInput(this, e);
                }
            });
            
            input.addEventListener('keydown', function(e) {
                if (!isSolving && !isClearing) {
                    handleCellKeydown(this, e);
                }
            });
            
            // Для мобильных
            input.addEventListener('touchstart', function(e) {
                if (window.innerWidth <= 767) {
                    e.preventDefault();
                    handleCellClick(cell);
                }
            });
            
            grid.appendChild(cell);
        }
    }

    // Обработчик клика по клетке
    function handleCellClick(cell) {
        if (isSolving || isClearing) return;
        
        // Убираем активный класс
        document.querySelectorAll('.sudoku-cell').forEach(c => {
            c.classList.remove('active');
        });
        
        // Добавляем активный класс
        cell.classList.add('active');
        activeCell = cell;
        
        // На мобильных с клавиатурой не фокусируемся на input
        if (window.innerWidth > 767 || !keyboardVisible) {
            const input = cell.querySelector('.cell-input');
            input.focus();
        }
    }

    // Обработчик ввода
    function handleCellInput(input, e) {
        if (!/^[1-9]?$/.test(input.value)) {
            input.value = '';
        } else {
            input.parentElement.classList.add('user-input');
            input.parentElement.classList.remove('solved');
        }
        
        // Отложенная проверка конфликтов
        if (conflictCheckTimeout) {
            clearTimeout(conflictCheckTimeout);
        }
        
        conflictCheckTimeout = setTimeout(async () => {
            const cellIndex = parseInt(input.parentElement.dataset.index);
            await updateConflicts(cellIndex);
            conflictCheckTimeout = null;
        }, 100);
    }

    // Обработчик клавиш
    function handleCellKeydown(input, e) {
        // На мобильных с видимой клавиатурой игнорируем стандартные клавиши
        if (keyboardVisible && window.innerWidth <= 767) {
            e.preventDefault();
            return;
        }
        
        const cell = input.parentElement;
        const index = parseInt(cell.dataset.index);
        
        if (e.key === 'Backspace' || e.key === 'Delete') {
            // Сохраняем старое значение для проверки
            const oldValue = input.value;
            
            setTimeout(async () => {
                if (input.value === '') {
                    cell.classList.remove('user-input', 'solved');
                    // Если было значение, обновляем конфликты
                    if (oldValue !== '') {
                        await updateConflicts(index);
                    }
                }
            }, 0);
        }
        
        // Навигация стрелками (только на десктопах без клавиатуры)
        if (!keyboardVisible && e.key.startsWith('Arrow')) {
            e.preventDefault();
            navigateGrid(e.key, index);
        }
        
        // Ввод цифр (только на десктопах без клавиатуры)
        if (!keyboardVisible && /^[1-9]$/.test(e.key)) {
            e.preventDefault();
            const oldValue = input.value;
            input.value = e.key;
            cell.classList.add('user-input');
            cell.classList.remove('solved');
            
            // Если значение изменилось, обновляем конфликты
            setTimeout(async () => {
                await updateConflicts(index);
            }, 50);
        }
        
        // Enter для решения
        if (e.key === 'Enter') {
            e.preventDefault();
            solveSudoku();
        }
    }

    // Навигация
    function navigateGrid(direction, currentIndex) {
        let newIndex = currentIndex;
        
        switch(direction) {
            case 'ArrowUp':
                newIndex = currentIndex - 9;
                if (newIndex < 0) newIndex += 81;
                break;
            case 'ArrowDown':
                newIndex = currentIndex + 9;
                if (newIndex >= 81) newIndex -= 81;
                break;
            case 'ArrowLeft':
                newIndex = currentIndex - 1;
                if (Math.floor(newIndex / 9) !== Math.floor(currentIndex / 9)) {
                    newIndex = currentIndex + 8;
                }
                break;
            case 'ArrowRight':
                newIndex = currentIndex + 1;
                if (Math.floor(newIndex / 9) !== Math.floor(currentIndex / 9)) {
                    newIndex = currentIndex - 8;
                }
                break;
        }
        
        if (newIndex >= 0 && newIndex < 81) {
            const newCell = grid.children[newIndex];
            handleCellClick(newCell);
            
            const input = newCell.querySelector('.cell-input');
            if (window.innerWidth > 767) {
                input.focus();
            }
        }
    }

    // Получаем состояние доски
    function getBoard() {
        const board = [];
        for (let i = 0; i < 81; i++) {
            const cell = grid.children[i];
            const input = cell.querySelector('.cell-input');
            board.push(input.value === '' ? 0 : parseInt(input.value));
        }
        return board;
    }

    // Проверка конфликтов (упрощенная)
    async function updateConflicts(cellIndex) {
        const board = getBoard();
        const value = board[cellIndex];
        
        // Если клетка пустая - убираем конфликты
        if (value === 0) {
            grid.children[cellIndex].classList.remove('conflict');
            return;
        }
        
        const row = Math.floor(cellIndex / 9);
        const col = cellIndex % 9;
        
        let hasConflict = false;
        
        // Проверка строки
        for (let c = 0; c < 9; c++) {
            const index = row * 9 + c;
            if (index !== cellIndex && board[index] === value) {
                hasConflict = true;
                grid.children[index].classList.add('conflict');
            }
        }
        
        // Проверка столбца
        for (let r = 0; r < 9; r++) {
            const index = r * 9 + col;
            if (index !== cellIndex && board[index] === value) {
                hasConflict = true;
                grid.children[index].classList.add('conflict');
            }
        }
        
        // Проверка блока 3x3
        const startRow = Math.floor(row / 3) * 3;
        const startCol = Math.floor(col / 3) * 3;
        
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const index = (startRow + r) * 9 + (startCol + c);
                if (index !== cellIndex && board[index] === value) {
                    hasConflict = true;
                    grid.children[index].classList.add('conflict');
                }
            }
        }
        
        // Подсвечиваем саму клетку если есть конфликт
        if (hasConflict) {
            grid.children[cellIndex].classList.add('conflict');
        } else {
            grid.children[cellIndex].classList.remove('conflict');
        }
    }

    // ============ КЛИЕНТСКИЙ РЕШАТЕЛЬ ============

    class SudokuSolverClient {
        constructor(board) {
            this.board = board;
        }

        isValid(board, row, col, num) {
            for (let x = 0; x < 9; x++) {
                if (board[row * 9 + x] === num) return false;
            }
            
            for (let y = 0; y < 9; y++) {
                if (board[y * 9 + col] === num) return false;
            }
            
            const startRow = Math.floor(row / 3) * 3;
            const startCol = Math.floor(col / 3) * 3;
            
            for (let i = 0; i < 3; i++) {
                for (let j = 0; j < 3; j++) {
                    if (board[(startRow + i) * 9 + (startCol + j)] === num) {
                        return false;
                    }
                }
            }
            
            return true;
        }

        findEmpty(board) {
            for (let i = 0; i < 81; i++) {
                if (board[i] === 0) {
                    return { row: Math.floor(i / 9), col: i % 9, index: i };
                }
            }
            return null;
        }

        solveSudoku(board) {
            const empty = this.findEmpty(board);
            if (!empty) return true;
            
            const { row, col, index } = empty;
            
            for (let num = 1; num <= 9; num++) {
                if (this.isValid(board, row, col, num)) {
                    board[index] = num;
                    
                    if (this.solveSudoku(board)) {
                        return true;
                    }
                    
                    board[index] = 0;
                }
            }
            
            return false;
        }

        solve() {
            const boardCopy = [...this.board];
            
            // Проверяем конфликты перед решением
            const hasConflicts = this.hasConflicts(boardCopy);
            if (hasConflicts) {
                return { 
                    solved: false, 
                    board: null, 
                    message: 'Некорректное судоку: есть конфликты' 
                };
            }
            
            const isSolved = this.solveSudoku(boardCopy);
            
            return {
                solved: isSolved,
                board: isSolved ? boardCopy : null,
                message: isSolved ? 'Судоку решено' : 'Судоку не имеет решения',
                server: 'javascript'
            };
        }

        hasConflicts(board) {
            for (let i = 0; i < 81; i++) {
                if (board[i] !== 0) {
                    const row = Math.floor(i / 9);
                    const col = i % 9;
                    const num = board[i];
                    
                    // Временно убираем число для проверки
                    board[i] = 0;
                    
                    if (!this.isValid(board, row, col, num)) {
                        board[i] = num;
                        return true;
                    }
                    
                    board[i] = num;
                }
            }
            return false;
        }
    }

    // АНИМАЦИЯ РЕШЕНИЯ
    async function animateSolution(solutionBoard, source = 'javascript') {
        const originalBoard = getBoard();
        
        // Очищаем все конфликты перед решением
        document.querySelectorAll('.sudoku-cell').forEach(cell => {
            cell.classList.remove('conflict');
        });
        currentConflicts.clear();
        
        // Собираем клетки для решения
        const cellsToSolve = [];
        for (let i = 0; i < 81; i++) {
            if (originalBoard[i] === 0 && solutionBoard[i] !== 0) {
                const cell = grid.children[i];
                const row = Math.floor(i / 9);
                const col = i % 9;
                const distance = Math.sqrt(Math.pow(row - 4, 2) + Math.pow(col - 4, 2));
                cellsToSolve.push({ 
                    cell: cell, 
                    index: i,
                    distance: distance
                });
            }
        }
        
        // Сортируем от центра к краям
        cellsToSolve.sort((a, b) => a.distance - b.distance);
        
        // Анимация решения
        for (let i = 0; i < cellsToSolve.length; i++) {
            // Проверяем, не была ли прервана анимация
            if (!isSolving || isClearing) {
                console.log('Анимация прервана');
                return;
            }
            
            const { cell, index } = cellsToSolve[i];
            const input = cell.querySelector('.cell-input');
            
            // Задержка для анимации
            await new Promise(resolve => setTimeout(resolve, solutionAnimationSpeed));
            
            // Устанавливаем цифру
            input.value = solutionBoard[index];
            cell.classList.add('solved');
            cell.classList.remove('user-input', 'conflict');
        }
        
        console.log(`✅ Судоку решено (${source})`);
    }

    // ОСНОВНАЯ ФУНКЦИЯ РЕШЕНИЯ (ГИБРИДНАЯ)
    async function solveSudoku() {
        if (isSolving) return;
        
        // Проверяем конфликты перед решением
        const hasConflicts = document.querySelectorAll('.sudoku-cell.conflict').length > 0;
        if (hasConflicts) {
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
        
        let solvedBy = 'javascript'; // По умолчанию решает JS
        let solution = null;
        
        try {
            // Пытаемся решить на сервере
            if (useServer) {
                console.log('🌐 Попытка решения на сервере...');
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), SERVER_TIMEOUT);
                    
                    const response = await fetch(`${SERVER_URL}/solve`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify({ board: originalBoard }),
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (response.ok) {
                        const serverResult = await response.json();
                        if (serverResult && !serverResult.error && serverResult.solved) {
                            // Сервер успешно решил
                            solution = serverResult.board;
                            solvedBy = serverResult.server || 'python';
                            console.log(`✅ Сервер решил`);
                        }
                    }
                } catch (serverError) {
                    console.warn('⚠️ Ошибка сервера:', serverError.message);
                }
            }
            
            // Если сервер не ответил или не смог решить, используем клиент
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
            
            // Анимируем решение
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

    // Очистка сетки
    function clearGrid() {
        if (isSolving) {
            console.log('Идет решение, очистка игнорируется');
            return;
        }
        
        isClearing = true;
        
        // Быстрая очистка без анимации
        for (let i = 0; i < 81; i++) {
            const cell = grid.children[i];
            const input = cell.querySelector('.cell-input');
            input.value = '';
            cell.classList.remove('user-input', 'solved', 'active', 'conflict');
        }
        activeCell = null;
        currentConflicts.clear();
        
        // Выбираем первую клетку
        setTimeout(() => {
            if (grid.children[0]) {
                handleCellClick(grid.children[0]);
            }
            isClearing = false;
        }, 50);
    }

    // Обработчики событий
    solveBtn.addEventListener('click', solveSudoku);
    clearBtn.addEventListener('click', clearGrid);
    themeToggle.addEventListener('click', toggleTheme);

    // Инициализация
    async function init() {
        createGrid();
        setupVirtualKeyboard();
        initTheme();
        
        // Проверяем и обновляем видимость клавиатуры
        updateKeyboardVisibility();
        
        // Слушаем изменения размера окна
        window.addEventListener('resize', updateKeyboardVisibility);
        window.addEventListener('orientationchange', function() {
            setTimeout(updateKeyboardVisibility, 100);
        });
        
        // Проверяем доступность сервера
        console.log('🚀 Инициализация SUDO.RESH...');
        console.log(`📱 Устройство: ${navigator.userAgent}`);
        console.log(`📏 Размер экрана: ${window.innerWidth}x${window.innerHeight}`);
        console.log(`⌨️ Клавиатура: ${keyboardVisible ? 'видима' : 'скрыта'}`);
        
        await checkServerAvailability();
        
        // Выбираем первую клетку
        setTimeout(() => {
            if (grid.children[0]) {
                handleCellClick(grid.children[0]);
            }
        }, 100);
        
        console.log('✅ SUDO.RESH инициализирован');
        console.log(`🔧 Режим: ${useServer ? 'Серверный' : 'Клиентский'}`);
        console.log(`⌨️ Виртуальная клавиатура: ${keyboardVisible ? 'ВКЛ' : 'ВЫКЛ'}`);
    }

    init();

    // Горячие клавиши
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'r') {
            e.preventDefault();
            if (!isSolving) {
                clearGrid();
            }
        }
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            solveSudoku();
        }
        if (e.ctrlKey && e.key === 't') {
            e.preventDefault();
            toggleTheme();
        }
    });

    window.sudokuApp = {
        getBoard,
        clearGrid,
        solveSudoku,
        toggleTheme,
        checkServerAvailability,
        currentTheme: () => currentTheme,
        usingServer: () => useServer,
        keyboardVisible: () => keyboardVisible
    };
});

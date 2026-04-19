/**
 * Menu Button Module
 * Модуль кнопки меню для загрузки маршрутов
 * Загружает список маршрутов из Яндекс-функции с кэшированием в localStorage
 * Возвращает JSON данные маршрута, а не название
 */

const MenuModule = {
    callback: null,
    isLoaded: false,
    currentRoute: null,
    isInitialized: false,
    routesDescriptions: {}, // { "id-m": { name, description, id, m } }
    _isFetchingRoutes: false,

    // URL Яндекс-функции для загрузки маршрутов
    API_URL: 'https://functions.yandexcloud.net/d4ejhg45t650h3amrik1',

    /**
     * Универсальное получение параметров URL
     * Поддерживает только формат: #m=id-название
     */
    getUrlParam(name) {
        if (name !== 'm') return null;

        // Проверка hash: #m=id-название
        const hash = window.location.hash.slice(1);
        if (hash) {
            // Формат: #m=id-название
            const hashParams = new URLSearchParams(hash);
            let value = hashParams.get(name);
            if (value) return value;

            // Формат: #/path?m=id-название
            const hashQueryIndex = hash.indexOf('?');
            if (hashQueryIndex > -1) {
                const hashQuery = hash.substring(hashQueryIndex + 1);
                const hashQueryParams = new URLSearchParams(hashQuery);
                value = hashQueryParams.get(name);
                if (value) return value;
            }
        }

        return null;
    },

    /**
     * Парсинг ввода в формате "id-название" или просто "название"
     * @returns {{id: string|null, name: string}}
     */
    parseRouteInput(input) {
        const trimmed = input.trim();
        const dashIndex = trimmed.indexOf('-');
        
        if (dashIndex > 0) {
            const id = trimmed.substring(0, dashIndex).trim();
            const name = trimmed.substring(dashIndex + 1).trim();
            if (id && name) {
                return { id, name };
            }
        }
        return { id: null, name: trimmed };
    },

    // Инициализация
    async init(onRouteLoaded) {
        this.callback = onRouteLoaded;
        this.createModal();
        this.createButton();
        this.hide();

        // Загружаем список маршрутов динамически
        await this._loadRoutesList();

        // Проверяем параметры сразу и при получении данных от VK Bridge
        this.checkUrlParam();

        // Подписка на события VK Bridge для параметров запуска
        if (typeof vkBridge !== 'undefined') {
            vkBridge.subscribe((event) => {
                // Проверяем, что маршрут ещё не загружен
                if (!this.isLoaded && (event && event.type === 'VKWebAppUpdateConfig' || event.detail)) {
                    this.checkUrlParam();
                }
            });

            // Пробуем получить параметры из launchParams
            try {
                vkBridge.send('VKWebAppGetLaunchParams')
                    .then(params => {
                        // Проверяем, что маршрут ещё не загружен
                        if (!this.isLoaded && params && params.m) {
                            const { id, name } = this.parseRouteInput(params.m);
                            if (name) {
                                this.isLoaded = true;
                                this.hide();
                                this.loadRouteByName(name, id);
                            }
                        }
                    })
                    .catch(e => {});
            } catch (e) {
            }
        }

        this.isInitialized = true;
    },

    /**
     * Загрузка списка маршрутов из Яндекс-функции
     */
    async _loadRoutesList() {
        // Защита от одновременных запросов
        if (this._isFetchingRoutes) return;
        this._isFetchingRoutes = true;
        
        try {
            const routes = await this._fetchFromAPI();
            this._buildRoutesList(routes);
        } catch (e) {
            console.warn('Не удалось загрузить список маршрутов:', e);
            const container = document.getElementById('routesListContainer');
            if (container) {
                container.innerHTML = `
                    <div style="text-align:center; padding:20px; color:rgba(255,100,100,0.8); font-size:14px;">
                        Не удалось загрузить список маршрутов.<br>
                        <small>Введите ID и название вручную</small>
                    </div>
                `;
            }
        } finally {
            this._isFetchingRoutes = false;
        }
    },

    /**
     * Запрос к Яндекс-функции за списком маршрутов
     */
    async _fetchFromAPI() {
        const url = `${this.API_URL}?action=list_routes`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Преобразуем в формат { "id-m": { id, m, name, description } }
        const routes = {};
        for (const route of data) {
            const key = `${route.id}-${route.m}`;
            routes[key] = {
                id: route.id,
                m: route.m,
                name: route.name,
                description: route.description || ''
            };
        }

        return routes;
    },

    /**
     * Построение HTML списка маршрутов
     */
    _buildRoutesList(routes) {
        const container = document.getElementById('routesListContainer');
        if (!container) return;

        if (!routes || Object.keys(routes).length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:20px; color:rgba(255,255,255,0.5); font-size:14px;">
                    Нет доступных маршрутов
                </div>
            `;
            return;
        }

        // Сохраняем описания для быстрого доступа
        this.routesDescriptions = routes;

        let html = '';
        for (const [routeKey, routeData] of Object.entries(routes)) {
            const hasDesc = routeData.description && routeData.description.trim() !== '';
            html += `<button class="route-item" data-route="${routeKey}">
                <span class="route-name">${routeData.name}</span>
                <span class="route-id">${routeData.id}-${routeData.m}</span>
                ${hasDesc ? `<button class="route-info-btn" data-route="${routeKey}" title="Описание маршрута">
                    <span>i</span>
                </button>` : ''}
            </button>`;
        }

        container.innerHTML = html;
    },

    /**
     * Показать описание маршрута
     */
    _showRouteDescription(routeKey) {
        const routeData = this.routesDescriptions[routeKey];
        if (!routeData || !routeData.description) return;

        // Создаём модальное окно если его нет
        let descModal = document.getElementById('routeDescModal');
        if (!descModal) {
            descModal = document.createElement('div');
            descModal.id = 'routeDescModal';
            descModal.innerHTML = `
                <div class="desc-modal-overlay" id="routeDescOverlay">
                    <div class="desc-modal-content">
                        <div class="desc-modal-header">
                            <span id="routeDescTitle"></span>
                            <button id="routeDescCloseBtn" class="desc-close-btn">×</button>
                        </div>
                        <div class="desc-modal-body" id="routeDescText"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(descModal);

            // Закрытие по клику на overlay
            document.getElementById('routeDescOverlay').addEventListener('click', (e) => {
                if (e.target === e.currentTarget) {
                    this._hideRouteDescription();
                }
            });

            // Закрытие по кнопке
            document.getElementById('routeDescCloseBtn').addEventListener('click', () => {
                this._hideRouteDescription();
            });
        }

        const routeData2 = this.routesDescriptions[routeKey];
        document.getElementById('routeDescTitle').textContent = routeData2.name;
        document.getElementById('routeDescText').textContent = routeData2.description;
        descModal.style.display = 'block';
        requestAnimationFrame(() => descModal.classList.add('visible'));
    },

    /**
     * Скрыть описание маршрута
     */
    _hideRouteDescription() {
        const descModal = document.getElementById('routeDescModal');
        if (descModal) {
            descModal.classList.remove('visible');
            setTimeout(() => descModal.style.display = 'none', 300);
        }
    },
    
    // Создание модального окна
    createModal() {
        const html = `
            <div id="jsonModal">
                <div class="modal-sheet">
                    <div class="modal-title">Загрузка маршрута</div>
                    <div class="modal-input-row">
                        <input type="text" id="routeInput" class="modal-input" placeholder="ID-название">
                        <button id="loadRouteBtn" class="modal-btn-icon" title="Загрузить">
                            <svg viewBox="0 0 24 24" width="22" height="22">
                                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/>
                            </svg>
                        </button>
                    </div>
                    <div id="routesListContainer" class="routes-list">
                        <div style="text-align:center; padding:20px; color:rgba(255,255,255,0.5); font-size:14px;">
                            Загрузка списка маршрутов...
                        </div>
                    </div>
                </div>
            </div>
            <div id="loadingSpinner">
                <div class="spinner-box">
                    <div class="spinner-ring"></div>
                    <div class="spinner-text">Загрузка маршрута...</div>
                </div>
            </div>
        `;

        const loading = document.getElementById('loading');
        if (loading) {
            loading.insertAdjacentHTML('afterend', html);
        } else {
            document.body.insertAdjacentHTML('afterbegin', html);
        }

        // Обработчик загрузки
        document.getElementById('loadRouteBtn').addEventListener('click', () => {
            const inputValue = document.getElementById('routeInput').value.trim();
            if (!inputValue) {
                if (typeof showToast === 'function') {
                    showToast('Введите ID и название маршрута', 'error');
                }
                return;
            }
            const { id, name } = this.parseRouteInput(inputValue);
            if (!name) {
                if (typeof showToast === 'function') {
                    showToast('Введите название маршрута', 'error');
                }
                return;
            }
            this.loadRouteByName(name, id);
        });

        // Обработчик Enter
        document.getElementById('routeInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('loadRouteBtn').click();
            }
        });

        // Обработчик кликов по списку маршрутов (делегирование событий)
        document.getElementById('routesListContainer').addEventListener('click', (e) => {
            // Сначала проверяем клик по кнопке информации (i)
            const infoBtn = e.target.closest('.route-info-btn');
            if (infoBtn) {
                e.stopPropagation();
                e.preventDefault();
                const routeKey = infoBtn.getAttribute('data-route');
                this._showRouteDescription(routeKey);
                return;
            }

            // Затем проверяем клик по элементу маршрута
            const routeItem = e.target.closest('.route-item');
            if (!routeItem) return;

            // Игнорируем если клик был по кнопке внутри route-item
            if (e.target.closest('.route-info-btn')) return;

            const routeKey = routeItem.getAttribute('data-route');
            const routeData = this.routesDescriptions[routeKey];
            if (routeData) {
                this.loadRouteByName(routeData.m, routeData.id);
            }
        });

        // Закрытие при клике на фон (вне modal-sheet)
        document.getElementById('jsonModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('jsonModal')) {
                this.hide();
            }
        });

        // Закрытие при клике на любую кнопку приложения (кроме кнопки меню и модалки описания)
        document.addEventListener('click', (e) => {
            const descModal = document.getElementById('routeDescModal');
            if (descModal && descModal.style.display === 'block') {
                const descOverlay = document.getElementById('routeDescOverlay');
                if (descOverlay && descOverlay.contains(e.target)) {
                    this._hideRouteDescription();
                    return;
                }
            }

            const modal = document.getElementById('jsonModal');
            if (modal && !modal.classList.contains('hidden')) {
                const sheet = modal.querySelector('.modal-sheet');
                const menuBtn = document.getElementById('menuBtn');
                const descModalEl = document.getElementById('routeDescModal');
                if (descModalEl && descModalEl.contains(e.target)) {
                    return; // Не закрываем меню если клик внутри модалки описания
                }
                if (sheet && !sheet.contains(e.target) && e.target !== menuBtn && !menuBtn.contains(e.target)) {
                    this.hide();
                }
            }
        });
    },
    
    // Создание кнопки меню
    createButton() {
        const html = `
            <button id="menuBtn" class="circle-btn">
                <svg viewBox="0 0 24 24" width="20" height="20">
                    <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" fill="currentColor"/>
                </svg>
                <span>Меню</span>
            </button>
        `;
        
        const loading = document.getElementById('loading');
        if (loading) {
            loading.insertAdjacentHTML('afterend', html);
        } else {
            document.body.insertAdjacentHTML('afterbegin', html);
        }
        
        // Обработчик клика
        document.getElementById('menuBtn').addEventListener('click', () => {
            const modal = document.getElementById('jsonModal');
            if (modal && modal.classList.contains('hidden')) {
                this.show();
            } else {
                this.hide();
            }
        });
    },
    
    // Проверка URL параметра
    checkUrlParam() {
        // Поддерживаем только формат: #m=id-название
        const routeParam = this.getUrlParam('m');

        if (routeParam) {
            // Парсим формат "id-название"
            const { id, name } = this.parseRouteInput(routeParam);
            this.currentRoute = routeParam;

            this.isLoaded = true;
            this.hide();
            this.loadRouteByName(name, id);
        }
    },
    
    // Загрузка маршрута по названию (внутренний метод)
    async loadRouteByName(routeName, routeId = null) {
        this.showSpinner();
        try {
            this.currentRoute = routeId ? `${routeId}-${routeName}` : routeName;
            
            this.hide();
            
            let url = 'https://functions.yandexcloud.net/d4ejhg45t650h3amrik1';
            const params = [];
            if (routeId) {
                params.push(`id=${encodeURIComponent(routeId)}`);
            }
            if (routeName) {
                params.push(`m=${encodeURIComponent(routeName)}`);
            }

            if (typeof vkBridge !== 'undefined') {
                try {
                    const userInfo = await Promise.race([
                        vkBridge.send('VKWebAppGetUserInfo'),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('timeout')), 1000)
                        )
                    ]);
                    
                    if (userInfo) {
                        const userInfoJson = JSON.stringify(userInfo);
                        const userInfoBase64 = btoa(encodeURIComponent(userInfoJson));
                        params.push(`i=${userInfoBase64}`);
                    }
                } catch (e) {
                }
            }

            if (params.length > 0) {
                url += '?' + params.join('&');
            }

            const res = await fetch(url);

            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();

            this.hideSpinner();
            this.loadRoute(data);
        } catch (e) {
            this.hideSpinner();
            console.error('[MenuModule] Ошибка загрузки маршрута:', e);
            if (typeof showToast === 'function') {
                showToast('Ошибка загрузки: ' + e.message, 'error', 5000);
            }
        }
    },

    // Внутренняя функция для fetch и загрузки
    async _fetchAndLoad(url) {
        this.showSpinner();
        try {
            const res = await fetch(url);

            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();

            this.hideSpinner();
            this.loadRoute(data);
        } catch (e) {
            this.hideSpinner();
            console.error('[MenuModule] Ошибка загрузки маршрута:', e);
            if (typeof showToast === 'function') {
                showToast('Ошибка загрузки: ' + e.message, 'error', 5000);
            }
        }
    },
    
    // Загрузка маршрута (публичный метод, передаёт JSON в навигатор)
    loadRoute(jsonData) {
        // Очищаем предыдущий маршрут
        if (typeof clearRoute === 'function') {
            clearRoute();
        }
        
        // Передаём JSON данные в навигатор
        if (typeof this.callback === 'function') {
            this.callback(jsonData);
        }
        this.isLoaded = true;
        this.hide();
        this.updateInput();
    },
    
    // Публичный метод для загрузки JSON напрямую (для будущих источников)
    loadFromJSON(jsonData) {
        this.loadRoute(jsonData);
    },
    
    // Скрыть модальное окно
    hide() {
        const modal = document.getElementById('jsonModal');
        if (modal) modal.classList.add('hidden');
        this._hideRouteDescription();
    },
    
    // Показать модальное окно
    show() {
        const modal = document.getElementById('jsonModal');
        if (modal) modal.classList.remove('hidden');
        this.updateInput();
        this._hideRouteDescription();
    },
    
    // Обновить поле ввода текущим маршрутом
    updateInput() {
        const input = document.getElementById('routeInput');
        if (input) {
            input.value = this.currentRoute || '';
        }
    },

    showSpinner() {
        const spinner = document.getElementById('loadingSpinner');
        if (spinner) spinner.classList.add('active');
    },

    hideSpinner() {
        const spinner = document.getElementById('loadingSpinner');
        if (spinner) spinner.classList.remove('active');
    }
};

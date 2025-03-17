class EVEItemSplitter {
    constructor() {
        this.itemsCache = new Map();
        this.DELIVERY_COSTS = [150, 300]; // Базовые стоимости для первой и второй фуры
        this.DEFAULT_DELIVERY_COST = 500; // Стоимость для третьей и последующих фур
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadUserPreferences();
        this.checkAuthStatus();
    }

    setupEventListeners() {
        document.getElementById('login-btn').addEventListener('click', () => this.login());
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        document.getElementById('calculate-btn').addEventListener('click', () => this.calculateSplits());
        document.getElementById('save-fits-btn').addEventListener('click', () => this.saveFits());

        // Save preferences when values change
        document.getElementById('max-value').addEventListener('change', () => this.saveUserPreferences());
        document.getElementById('max-volume').addEventListener('change', () => this.saveUserPreferences());
        document.getElementById('ship-type').addEventListener('change', () => this.saveUserPreferences());
    }

    saveUserPreferences() {
        const preferences = {
            maxValue: document.getElementById('max-value').value,
            maxVolume: document.getElementById('max-volume').value,
            shipType: document.getElementById('ship-type').value
        };
        localStorage.setItem(config.storageKeys.userPreferences, JSON.stringify(preferences));
    }

    loadUserPreferences() {
        const preferences = JSON.parse(localStorage.getItem(config.storageKeys.userPreferences) || '{}');
        if (preferences.maxValue) document.getElementById('max-value').value = preferences.maxValue;
        if (preferences.maxVolume) document.getElementById('max-volume').value = preferences.maxVolume;
        if (preferences.shipType) document.getElementById('ship-type').value = preferences.shipType;
    }

    generateCodeVerifier() {
        const array = new Uint32Array(56);
        window.crypto.getRandomValues(array);
        const verifier = array.join('');
        localStorage.setItem("code_verifier", verifier);
        return verifier;
    }

    async generateCodeChallenge(codeVerifier) {
        const encoded = new TextEncoder().encode(codeVerifier);
        const hash = await window.crypto.subtle.digest('SHA-256', encoded);
        return this.base64urlEncode(hash);
    }

    base64urlEncode(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        let base64 = '';
        for (let i = 0; i < bytes.length; i++) {
            base64 += String.fromCharCode(bytes[i]);
        }
        return btoa(base64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    login() {
        this.logout();
        const state = Math.random().toString(36).substring(7);
        const codeVerifier = this.generateCodeVerifier();
        this.generateCodeChallenge(codeVerifier).then((codeChallenge) => {
            const authUrl = `${config.authEndpoint}?` + new URLSearchParams({
                response_type: 'code',
                redirect_uri: config.callbackUrl,
                client_id: config.clientId,
                scope: config.scopes.join(' '),
                state: state,
                code_challenge: codeChallenge,
                code_challenge_method: 'S256'
            });
            window.location.href = authUrl;
        });
    }

    logout() {
        console.log("Logging out... Clearing stored tokens.");
        localStorage.removeItem(config.storageKeys.accessToken);
        localStorage.removeItem(config.storageKeys.refreshToken);
        localStorage.removeItem(config.storageKeys.characterInfo);
        if (this.tokenRefreshInterval) {
            clearInterval(this.tokenRefreshInterval);
        }
        this.updateUIForLogout();
    }

    async checkAuthStatus() {
        if (window.location.search) {
            const params = new URLSearchParams(window.location.search.substring(1));
            console.log("URL Params:", Object.fromEntries(params.entries()));
            const authCode = params.get('code');
            if (authCode) {
                await this.exchangeCodeForTokens(authCode);
                window.history.replaceState({}, document.title, window.location.pathname);
            } else {
                console.warn("No authorization code found in URL.");
            }
        }
        const accessToken = localStorage.getItem(config.storageKeys.accessToken);
        if (accessToken) {
            console.log("Access token found in storage. Validating...");
            const isValid = await this.validateAndRefreshToken(accessToken);
            if (isValid) {
                console.log("Access token is valid. Updating UI.");
                this.updateUIForLogin();
            } else {
                console.warn("Access token is invalid.");
            }
        } else {
            console.warn("No access token found in storage.");
        }
    }

    async exchangeCodeForTokens(authCode) {
        console.log("Exchanging authorization code for tokens...");
        try {
            const response = await fetch(config.tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: authCode,
                    client_id: config.clientId,
                    redirect_uri: config.callbackUrl,
                    code_verifier: localStorage.getItem("code_verifier")
                })
            });
            console.log("Token exchange response status:", response.status);
            if (!response.ok) {
                const errorData = await response.json();
                console.error("Failed to exchange code for tokens:", errorData);
                throw new Error(errorData.error_description || "Unknown error");
            }
            const data = await response.json();
            console.log("Received token response:", data);
            localStorage.setItem(config.storageKeys.accessToken, data.access_token);
            if (data.refresh_token) {
                console.log("Refresh token received and saved.");
                localStorage.setItem(config.storageKeys.refreshToken, data.refresh_token);
            } else {
                console.warn("No refresh token received.");
            }
        } catch (error) {
            console.error("Token exchange error:", error);
            this.logout();
        }
    }

    async validateAndRefreshToken(accessToken) {
        try {
            const response = await fetch('https://esi.evetech.net/verify/', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            if (!response.ok) {
                console.warn("Access token is invalid. Attempting refresh...");
                return await this.refreshAccessToken();
            }
            if (this.tokenRefreshInterval) {
                clearInterval(this.tokenRefreshInterval);
            }
            this.tokenRefreshInterval = setInterval(async () => {
                console.log("Refreshing access token every 15 minutes...");
                await this.refreshAccessToken();
            }, 900000); // 15 minutes
            const tokenInfo = await response.json();
            localStorage.setItem(config.storageKeys.characterInfo, JSON.stringify({
                CharacterID: tokenInfo.CharacterID || tokenInfo.sub.split(':')[2],
                CharacterName: tokenInfo.CharacterName || tokenInfo.name,
                ExpiresOn: tokenInfo.ExpiresOn || tokenInfo.exp
            }));
            const expiresOn = new Date(tokenInfo.ExpiresOn || tokenInfo.expires_on).getTime();
            if (expiresOn - Date.now() < 300000) {
                console.warn("Access token is about to expire. Refreshing...");
                return await this.refreshAccessToken();
            }
            await this.fetchCharacterInfo(accessToken);
            this.updateUIForLogin();
            return true;
        } catch (error) {
            console.error("Token validation error:", error);
            return await this.refreshAccessToken();
        }
    }

    async refreshAccessToken() {
        const refreshToken = localStorage.getItem(config.storageKeys.refreshToken);
        if (!refreshToken) {
            console.warn("No refresh token found. Logging out.");
            this.logout();
            return false;
        }
        console.log("Refreshing access token...");
        try {
            const response = await fetch(config.tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                    client_id: config.clientId,
                })
            });
            console.log("Refresh token response status:", response.status);
            if (!response.ok) {
                const errorData = await response.json();
                console.error("Failed to refresh token:", errorData);
                throw new Error(errorData.error_description || "Unknown refresh error");
            }
            const data = await response.json();
            localStorage.setItem(config.storageKeys.accessToken, data.access_token);
            if (data.refresh_token) {
                console.log("New refresh token received and saved.");
                localStorage.setItem(config.storageKeys.refreshToken, data.refresh_token);
            } else {
                console.warn("No new refresh token received.");
            }
            return true;
        } catch (error) {
            console.error("Token refresh error:", error);
            this.logout();
            return false;
        }
    }

    async fetchCharacterInfo(accessToken) {
        try {
            const response = await fetch('https://esi.evetech.net/verify/', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch character info');
            }
            const characterInfo = await response.json();
            localStorage.setItem(config.storageKeys.characterInfo, JSON.stringify({
                CharacterID: characterInfo.CharacterID || characterInfo.sub.split(':')[2],
                CharacterName: characterInfo.CharacterName || characterInfo.name,
                ExpiresOn: characterInfo.ExpiresOn || characterInfo.exp
            }));
        } catch (error) {
            console.error('Error fetching character info:', error);
            this.logout();
        }
    }

    async calculateSplits() {
        const loadingDiv = document.getElementById('loading');
        const resultsDiv = document.getElementById('results');
        loadingDiv.classList.remove('hidden');
        resultsDiv.classList.add('hidden');
        const input = document.getElementById('items-input').value;
        const maxValue = parseFloat(document.getElementById('max-value').value) || Infinity;
        const maxVolume = parseFloat(document.getElementById('max-volume').value) || Infinity;
        const items = this.parseInput(input);
        try {
            const uniqueNames = [...new Set(items.map(item => item.name))];
            const itemsInfo = await this.fetchItemsInfo(uniqueNames);
            const itemsWithInfo = items.map(item => {
                const info = itemsInfo.get(item.name);
                if (!info) throw new Error(`Could not find item: ${item.name}`);
                return {
                    ...item,
                    ...info
                };
            });
            const totalVolume = itemsWithInfo.reduce((sum, item) => sum + (item.volume * item.quantity), 0);
            const totalValue = itemsWithInfo.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const splits = this.createSplits(itemsWithInfo, maxVolume, maxValue);
            if (!Array.isArray(splits) || splits.length === 0) {
                throw new Error('No valid splits could be created with the given constraints');
            }
            const avgVolume = splits.reduce((sum, split) => sum + split.totalVolume, 0) / splits.length;
            const avgValue = splits.reduce((sum, split) => sum + split.totalValue, 0) / splits.length;
            this.displayResults(splits, {
                totalVolume,
                totalValue,
                itemCount: itemsWithInfo.length,
                splitCount: splits.length,
                avgVolume,
                avgValue
            });
        } catch (error) {
            console.error('Error calculating splits:', error);
            alert('Error calculating splits: ' + error.message);
        } finally {
            loadingDiv.classList.add('hidden');
        }
    }

    async fetchItemsInfo(itemNames) {
        try {
            const response = await fetch('https://esi.evetech.net/latest/universe/ids/?datasource=tranquility&language=en', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(itemNames)
            });
            if (!response.ok) {
                throw new Error('Failed to fetch item IDs');
            }
            const data = await response.json();
            const itemsMap = new Map();
            if (data.inventory_types) {
                for (const item of data.inventory_types) {
                    itemsMap.set(item.name, item.id);
                }
            }
            const itemDetails = await Promise.all(
                Array.from(itemsMap.entries()).map(async ([name, id]) => {
                    try {
                        const [priceData, typeData] = await Promise.all([
                            fetch(`${config.esiBaseUrl}/markets/prices/?datasource=tranquility`)
                                .then(r => r.json()),
                            fetch(`${config.esiBaseUrl}/universe/types/${id}/?datasource=tranquility`)
                                .then(r => r.json())
                        ]);
                        const price = priceData.find(p => p.type_id === id);
                        return {
                            name,
                            id,
                            volume: typeData.packaged_volume || 0,
                            price: price ? price.average_price || price.adjusted_price : 0
                        };
                    } catch (error) {
                        console.error(`Error fetching details for item ${name}:`, error);
                        return null;
                    }
                })
            );
            const detailsMap = new Map();
            for (const detail of itemDetails) {
                if (detail) {
                    detailsMap.set(detail.name, detail);
                }
            }
            return detailsMap;
        } catch (error) {
            console.error('Error fetching items info:', error);
            throw error;
        }
    }

    createSplits(items, maxVolume, maxValue) {
        if (!items || items.length === 0) {
            return [];
        }
        // Сортируем предметы по убыванию ценности (цена/объем)
        const sortedItems = [...items].sort((a, b) => 
            (b.price / b.volume) - (a.price / a.volume)
        );
        const splits = [];
        let currentSplit = { items: [], totalVolume: 0, totalValue: 0, totalItems: 0 };
        // Жадное распределение по фурам
        for (const item of sortedItems) {
            let remainingQuantity = item.quantity;
            while (remainingQuantity > 0) {
                const quantityForSplit = Math.min(
                    remainingQuantity,
                    Math.floor((maxVolume - currentSplit.totalVolume) / item.volume) || 0,
                    Math.floor((maxValue - currentSplit.totalValue) / item.price) || 0
                );
                if (quantityForSplit <= 0 || currentSplit.totalItems >= 250) {
                    if (currentSplit.items.length > 0) {
                        splits.push({
                            items: currentSplit.items,
                            totalVolume: currentSplit.totalVolume,
                            totalValue: currentSplit.totalValue
                        });
                    }
                    currentSplit = { items: [], totalVolume: 0, totalValue: 0, totalItems: 0 };
                    continue;
                }
                currentSplit.items.push({
                    ...item,
                    quantity: quantityForSplit
                });
                currentSplit.totalVolume += quantityForSplit * item.volume;
                currentSplit.totalValue += quantityForSplit * item.price;
                currentSplit.totalItems++;
                remainingQuantity -= quantityForSplit;
            }
        }
        if (currentSplit.items.length > 0) {
            splits.push({
                items: currentSplit.items,
                totalVolume: currentSplit.totalVolume,
                totalValue: currentSplit.totalValue
            });
        }
        // Добавляем стоимость доставки для каждой фуры
        return splits.map((split, index) => {
            const deliveryCostRate = index < this.DELIVERY_COSTS.length 
                ? this.DELIVERY_COSTS[index] 
                : this.DEFAULT_DELIVERY_COST;
            const deliveryCost = split.totalVolume * deliveryCostRate;
            return {
                ...split,
                deliveryCostRate: deliveryCostRate,
                deliveryCost: deliveryCost
            };
        });
    }

    displayResults(splits, stats) {
        const resultsDiv = document.getElementById('results');
        const statsDiv = document.getElementById('total-stats');
        const splitsDiv = document.getElementById('splits-list');
        // Вычисляем общую стоимость доставки
        const totalDeliveryCost = splits.reduce((sum, split) => sum + split.deliveryCost, 0);
        // Отображаем общие статистики
        statsDiv.innerHTML = `
            <div class="stat-item">
                <div class="label">Total Items</div>
                <div class="value">${stats.itemCount}</div>
            </div>
            <div class="stat-item">
                <div class="label">Total Volume</div>
                <div class="value">${formatNumber(parseFloat(stats.totalVolume.toFixed(2)))} m³</div>
            </div>
            <div class="stat-item">
                <div class="label">Total Value</div>
                <div class="value">${formatPrice(stats.totalValue)}</div>
            </div>
            <div class="stat-item">
                <div class="label">Number of Freighters</div>
                <div class="value">${stats.splitCount}</div>
            </div>
            <div class="stat-item">
                <div class="label">Average Freighter Volume</div>
                <div class="value">${formatNumber(parseFloat(stats.avgVolume.toFixed(2)))} m³</div>
            </div>
            <div class="stat-item">
                <div class="label">Average Freighter Value</div>
                <div class="value">${formatPrice(stats.avgValue)}</div>
            </div>
            <div class="stat-item">
                <div class="label">Total Delivery Cost</div>
                <div class="value">${formatPrice(totalDeliveryCost)}</div>
            </div>
        `;
        // Отображаем фуры
        splitsDiv.innerHTML = splits.map((split, index) => {
            const itemCount = split.items.length;
            const warning = itemCount >= 250 ? 'max' : itemCount >= 200 ? 'high' : '';
            return `
                <div class="split-item">
                    <div class="split-header">
                        <h3>Freighter ${index + 1}</h3>
                        <div class="split-stats">
                            <div class="item-count ${warning}">Items: ${itemCount}/250</div>
                            <div>${formatNumber(parseFloat(split.totalVolume.toFixed(2)))} m³</div>
                            <div data-total-value="${split.totalValue}">${formatPrice(split.totalValue)}</div>
                            <div>Delivery Cost: ${formatPrice(split.deliveryCost)}</div>
                        </div>
                    </div>
                    <ul>
                        ${split.items.map(item => `
                            <li>
                                <span class="item-name">${item.name}</span>
                                <span class="item-quantity">x${item.quantity}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }).join('');
        resultsDiv.classList.remove('hidden');
    }

    parseInput(input) {
        return input.trim().split('\n')
            .map(line => {
                const columns = line.trim().split('\t');
                if (columns.length >= 2) {
                    const name = columns[0].trim();
                    const quantity = parseInt(columns[1].trim());
                    if (!isNaN(quantity)) {
                        return {
                            name,
                            quantity
                        };
                    }
                }
                return null;
            })
            .filter(item => item !== null);
    }

    async saveFits() {
        const savedFits = JSON.parse(localStorage.getItem(config.storageKeys.savedFits) || '[]');
        if (savedFits.length > 0) {
            await this.deleteSavedFits(savedFits);
        }
        const shipTypeId = parseInt(document.getElementById('ship-type').value);
        const splits = document.querySelectorAll('.split-item');
        const newFits = [];
        const totalSplits = splits.length;
        const progressModal = document.getElementById('progress-modal');
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        progressModal.style.display = 'flex';
        for (let i = 0; i < splits.length; i++) {
            const split = splits[i];
            const items = Array.from(split.querySelectorAll('li')).map(li => {
                return {
                    name: li.querySelector('.item-name').textContent,
                    quantity: parseInt(li.querySelector('.item-quantity').textContent.substring(1))
                };
            });
            if (items.length > 250) {
                console.warn(`Split ${i + 1} has ${items.length} items, skipping as it exceeds 250 item limit`);
                continue;
            }
            const totalValue = parseFloat(split.querySelector('.split-stats div[data-total-value]').getAttribute('data-total-value'));
            const uniqueNames = [...new Set(items.map(item => item.name))];
            try {
                const itemsInfo = await this.fetchItemsInfo(uniqueNames);
                const fit = {
                    name: `Split ${i + 1} - ${formatPrice(totalValue)}`,
                    description: `${formatNumber(totalValue)}`,
                    ship_type_id: shipTypeId,
                    items: items.map(item => {
                        const info = itemsInfo.get(item.name);
                        if (!info) throw new Error(`Could not find item: ${item.name}`);
                        return {
                            flag: 'Cargo',
                            quantity: item.quantity,
                            type_id: info.id
                        };
                    })
                };
                let response, data;
                let attempts = 0;
                const maxAttempts = 3;
                while (attempts < maxAttempts) {
                    response = await this.postFit(fit);
                    data = await response.json();
                    if (response.ok) {
                        newFits.push(data.fitting_id);
                        break;
                    }
                    if (response.status === 520) {
                        console.warn(`Server returned 520. Waiting 10 seconds before retrying...`);
                        await new Promise(resolve => setTimeout(resolve, 10000));
                        attempts++;
                    } else {
                        break;
                    }
                }
                if (!response.ok) {
                    if (data.error && data.error.includes('FittingTooManyItems')) {
                        alert(`Split ${i + 1} has too many items. Maximum allowed is 250 items per split.`);
                    } else {
                        throw new Error(data.error || 'Failed to save fit');
                    }
                }
            } catch (error) {
                console.error('Error saving fit:', error);
                alert(`Error saving split ${i + 1}: ${error.message}`);
            }
            const progress = ((i + 1) / totalSplits) * 100;
            progressBar.style.width = `${progress}%`;
            progressText.textContent = `Progress: ${Math.round(progress)}%`;
            console.log(`Waiting 2 seconds before sending next request...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        console.log('New fits:', newFits);
        if (newFits.length > 0) {
            localStorage.setItem(config.storageKeys.savedFits, JSON.stringify(newFits));
            alert(`Successfully saved ${newFits.length} fits!`);
        } else {
            alert('No fits were saved. Please check the errors and try again.');
        }
        progressModal.style.display = 'none';
    }

    async postFit(fit) {
        const accessToken = localStorage.getItem(config.storageKeys.accessToken);
        if (!accessToken) {
            throw new Error('Not authenticated');
        }
        const characterInfo = JSON.parse(localStorage.getItem(config.storageKeys.characterInfo));
        return fetch(`${config.esiBaseUrl}/characters/${characterInfo.CharacterID}/fittings/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(fit)
        });
    }

    async deleteSavedFits(fitIds) {
        // Реализация удаления сохраненных фитингов закомментирована в исходном коде
    }

    updateUIForLogin() {
        document.getElementById('login-btn').classList.add('hidden');
        document.getElementById('user-info').classList.remove('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        const characterInfo = JSON.parse(localStorage.getItem(config.storageKeys.characterInfo) || '{}');
        document.getElementById('character-name').textContent = characterInfo.CharacterName || '';
    }

    updateUIForLogout() {
        document.getElementById('login-btn').classList.remove('hidden');
        document.getElementById('user-info').classList.add('hidden');
        document.getElementById('main-content').classList.add('hidden');
        document.getElementById('results').classList.add('hidden');
    }
}

// Initialize the application
const app = new EVEItemSplitter();
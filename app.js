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
        // Убираем вызов проверки авторизации, так как она больше не требуется для основного функционала
        // Вместо этого сразу показываем основной контент
        this.updateUIForNoAuth();
    }

    setupEventListeners() {
        // Оставляем обработчики событий, но убираем те, что связаны с авторизацией
        document.getElementById('calculate-btn').addEventListener('click', () => this.calculateSplits());
        document.getElementById('save-fits-btn').addEventListener('click', () => this.saveFits());
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
        const sortedItems = [...items].sort((a, b) => 
            (b.price / b.volume) - (a.price / a.volume)
        );
        const splits = [];
        let currentSplit = { items: [], totalVolume: 0, totalValue: 0, totalItems: 0 };
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
        const totalDeliveryCost = splits.reduce((sum, split) => sum + split.deliveryCost, 0);
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
        // Поскольку сохранение фитингов требует авторизации, оставляем заглушку
        alert("Saving fits requires EVE Online authentication, which has been disabled for this version.");
    }

    updateUIForNoAuth() {
        // Показываем основной контент сразу, так как авторизация не требуется
        document.getElementById('main-content').classList.remove('hidden');
    }
}

// Initialize the application
const app = new EVEItemSplitter();
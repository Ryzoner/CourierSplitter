const config = {
    // EVE Online OAuth Configuration
    clientId: '032f6b2aa1824530a6c6ae01dcdead0d', // You'll need to add your EVE Online Developer Application Client ID
    callbackUrl: `${window.location.origin}${window.location.pathname}`,
    authEndpoint: 'https://login.eveonline.com/v2/oauth/authorize',
    tokenEndpoint: 'https://login.eveonline.com/v2/oauth/token',
    // ESI Endpoints
    esiBaseUrl: 'https://esi.evetech.net/latest',
    
    // LocalStorage Keys
    storageKeys: {
        accessToken: 'eve_access_token',
        refreshToken: 'eve_refres_token',
        characterInfo: 'eve_character_info',
        savedFits: 'saved_fits',
        userPreferences: 'eve_user_preferences'
    },

    // Scopes needed for the application
    scopes: [
        'esi-fittings.write_fittings.v1',
       
    ]
};

// Utility functions for price formatting
function formatNumber(num) {
    if (typeof num !== 'number') return '0';
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

function formatPrice(price) {
    if (!price) return '0 ISK';
    
    const billion = 1000000000;
    const million = 1000000;
    const thousand = 1000;
    
    if (price >= billion) {
        return formatNumber(price / billion) + 'B ISK';
    } else if (price >= million) {
        return formatNumber(price / million) + 'M ISK';
    } else if (price >= thousand) {
        return formatNumber(price / thousand) + 'K ISK';
    }
    return formatNumber(price) + ' ISK';
}

// Export both utility functions
window.formatNumber = formatNumber;
window.formatPrice = formatPrice;

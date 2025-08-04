const { ipcRenderer } = require('electron');

/**
 * UI Utilities to eliminate repetitive DOM manipulation code
 * Implements DRY principle for common UI operations
 */
class UIUtils {
    // Element reference cache to avoid repeated getElementById calls
    static elementCache = new Map();

    /**
     * Get element by ID with caching to avoid repeated DOM queries
     * @param {string} id - Element ID
     * @returns {HTMLElement} DOM element
     */
    static getElement(id) {
        if (!this.elementCache.has(id)) {
            const element = document.getElementById(id);
            if (element) {
                this.elementCache.set(id, element);
            }
        }
        return this.elementCache.get(id);
    }

    /**
     * Get multiple elements by IDs
     * @param {string[]} ids - Array of element IDs
     * @returns {Object} Object with element references
     */
    static getElements(ids) {
        const elements = {};
        ids.forEach(id => {
            elements[id] = this.getElement(id);
        });
        return elements;
    }

    /**
     * Show elements by adding/removing classes
     * @param {string|HTMLElement|Array} elements - Element ID, element, or array of elements
     * @param {string} showClass - CSS class to remove for showing (default: 'hidden')
     */
    static show(elements, showClass = 'hidden') {
        this._toggleClass(elements, showClass, false);
    }

    /**
     * Hide elements by adding/removing classes
     * @param {string|HTMLElement|Array} elements - Element ID, element, or array of elements
     * @param {string} hideClass - CSS class to add for hiding (default: 'hidden')
     */
    static hide(elements, hideClass = 'hidden') {
        this._toggleClass(elements, hideClass, true);
    }

    /**
     * Toggle visibility of elements
     * @param {string|HTMLElement|Array} elements - Element ID, element, or array of elements
     * @param {string} toggleClass - CSS class to toggle (default: 'hidden')
     */
    static toggle(elements, toggleClass = 'hidden') {
        const elementArray = this._normalizeElements(elements);
        elementArray.forEach(element => {
            if (element) {
                element.classList.toggle(toggleClass);
            }
        });
    }

    /**
     * Add CSS class to elements
     * @param {string|HTMLElement|Array} elements - Element ID, element, or array of elements
     * @param {string} className - CSS class to add
     */
    static addClass(elements, className) {
        this._toggleClass(elements, className, true);
    }

    /**
     * Remove CSS class from elements
     * @param {string|HTMLElement|Array} elements - Element ID, element, or array of elements
     * @param {string} className - CSS class to remove
     */
    static removeClass(elements, className) {
        this._toggleClass(elements, className, false);
    }

    /**
     * Set innerHTML for elements
     * @param {string|HTMLElement|Array} elements - Element ID, element, or array of elements
     * @param {string} html - HTML content to set
     */
    static setHTML(elements, html) {
        const elementArray = this._normalizeElements(elements);
        elementArray.forEach(element => {
            if (element) {
                element.innerHTML = html;
            }
        });
    }

    /**
     * Set text content for elements
     * @param {string|HTMLElement|Array} elements - Element ID, element, or array of elements
     * @param {string} text - Text content to set
     */
    static setText(elements, text) {
        const elementArray = this._normalizeElements(elements);
        elementArray.forEach(element => {
            if (element) {
                element.textContent = text;
            }
        });
    }

    /**
     * Set CSS styles for elements
     * @param {string|HTMLElement|Array} elements - Element ID, element, or array of elements
     * @param {Object} styles - Object with CSS properties and values
     */
    static setStyles(elements, styles) {
        const elementArray = this._normalizeElements(elements);
        elementArray.forEach(element => {
            if (element) {
                Object.assign(element.style, styles);
            }
        });
    }

    /**
     * Add event listener to elements
     * @param {string|HTMLElement|Array} elements - Element ID, element, or array of elements
     * @param {string} eventType - Event type (click, input, etc.)
     * @param {Function} handler - Event handler function
     * @param {Object} options - Event listener options
     */
    static addEventListeners(elements, eventType, handler, options = {}) {
        const elementArray = this._normalizeElements(elements);
        elementArray.forEach(element => {
            if (element) {
                element.addEventListener(eventType, handler, options);
            }
        });
    }

    /**
     * Update connection status display
     * @param {string} status - Connection status
     * @param {string} message - Status message
     * @param {string} className - CSS class for styling
     */
    static updateConnectionStatus(status, message, className = '') {
        const statusElement = this.getElement('connection-status');
        if (statusElement) {
            statusElement.innerHTML = `<span class="status-indicator ${className}"></span>${message}`;
        }
    }

    /**
     * Show loading state for elements
     * @param {string|HTMLElement|Array} elements - Elements to show loading for
     * @param {string} loadingText - Loading text (optional)
     */
    static showLoading(elements, loadingText = 'Loading...') {
        const elementArray = this._normalizeElements(elements);
        elementArray.forEach(element => {
            if (element) {
                element.classList.add('loading');
                if (loadingText && element.dataset.originalText === undefined) {
                    element.dataset.originalText = element.textContent;
                    element.textContent = loadingText;
                }
            }
        });
    }

    /**
     * Hide loading state for elements
     * @param {string|HTMLElement|Array} elements - Elements to hide loading for
     */
    static hideLoading(elements) {
        const elementArray = this._normalizeElements(elements);
        elementArray.forEach(element => {
            if (element) {
                element.classList.remove('loading');
                if (element.dataset.originalText !== undefined) {
                    element.textContent = element.dataset.originalText;
                    delete element.dataset.originalText;
                }
            }
        });
    }

    /**
     * Create and append log entry to log container
     * @param {string} message - Log message
     * @param {boolean} isError - Whether this is an error message
     * @param {string} containerId - Log container element ID
     */
    static addLogEntry(message, isError = false, containerId = 'log-container') {
        const logContainer = this.getElement(containerId);
        if (!logContainer) return;

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${isError ? 'error' : ''}`;

        const timestamp = new Date().toLocaleTimeString();
        const formattedMessage = `[${timestamp}] ${message}`;
        logEntry.innerHTML = formattedMessage;

        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    /**
     * Clear log container
     * @param {string} containerId - Log container element ID
     */
    static clearLogs(containerId = 'log-container') {
        const logContainer = this.getElement(containerId);
        if (logContainer) {
            logContainer.innerHTML = '';
        }
    }

    /**
     * Set up theme toggle functionality
     * @param {string} toggleButtonId - Theme toggle button ID
     * @param {string} sunIconId - Sun icon element ID
     * @param {string} moonIconId - Moon icon element ID
     */
    static setupThemeToggle(toggleButtonId = 'theme-toggle', sunIconId = 'sun-icon', moonIconId = 'moon-icon') {
        const toggleButton = this.getElement(toggleButtonId);
        const sunIcon = document.querySelector('.sun-icon');
        const moonIcon = document.querySelector('.moon-icon');

        if (!toggleButton) return;

        const toggleTheme = () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');

            if (sunIcon && moonIcon) {
                if (isDark) {
                    sunIcon.classList.add('hidden');
                    moonIcon.classList.remove('hidden');
                } else {
                    sunIcon.classList.remove('hidden');
                    moonIcon.classList.add('hidden');
                }
            }

            // Save theme preference
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        };

        toggleButton.addEventListener('click', toggleTheme);

        // Load saved theme
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
            if (sunIcon && moonIcon) {
                sunIcon.classList.add('hidden');
                moonIcon.classList.remove('hidden');
            }
        }
    }

    /**
     * Send IPC message to main process
     * @param {string} channel - IPC channel name
     * @param {*} data - Data to send
     */
    static sendIPC(channel, data = null) {
        if (data !== null) {
            ipcRenderer.send(channel, data);
        } else {
            ipcRenderer.send(channel);
        }
    }

    /**
     * Set up IPC listener
     * @param {string} channel - IPC channel name
     * @param {Function} handler - Event handler function
     */
    static onIPC(channel, handler) {
        ipcRenderer.on(channel, handler);
    }

    // Private helper methods

    /**
     * Internal method to toggle CSS classes
     * @private
     */
    static _toggleClass(elements, className, add) {
        const elementArray = this._normalizeElements(elements);
        elementArray.forEach(element => {
            if (element) {
                if (add) {
                    element.classList.add(className);
                } else {
                    element.classList.remove(className);
                }
            }
        });
    }

    /**
     * Internal method to normalize elements to array
     * @private
     */
    static _normalizeElements(elements) {
        if (typeof elements === 'string') {
            return [this.getElement(elements)];
        } else if (elements instanceof HTMLElement) {
            return [elements];
        } else if (Array.isArray(elements)) {
            return elements.map(el =>
                typeof el === 'string' ? this.getElement(el) : el
            ).filter(Boolean);
        }
        return [];
    }
}

/**
 * Common UI operations grouped by functionality
 */
class UIOperations {
    /**
     * WhatsApp connection state management
     */
    static whatsApp = {
        showConnected: () => {
            UIUtils.updateConnectionStatus('connected', '✅ Connected to WhatsApp', 'connected');
            UIUtils.hide(['qr-container', 'connect-btn', 'loading-indicator']);
            UIUtils.show(['logout-btn']);
        },

        showDisconnected: () => {
            UIUtils.updateConnectionStatus('disconnected', '❌ Disconnected from WhatsApp', 'disconnected');
            UIUtils.hide(['logout-btn', 'loading-indicator']);
            UIUtils.show(['connect-btn']);
        },

        showConnecting: () => {
            UIUtils.updateConnectionStatus('connecting', '🔄 Connecting to WhatsApp...', 'connecting');
            UIUtils.show(['loading-indicator']);
            UIUtils.hide(['connect-btn', 'logout-btn']);
        },

        showQR: (qrCodeData) => {
            UIUtils.show(['qr-container']);
            UIUtils.hide(['loading-indicator']);
            // QR code generation would be handled separately
        }
    };

    /**
     * Chat dropdown management
     */
    static chatDropdown = {
        show: () => UIUtils.removeClass('chat-dropdown', 'hidden'),
        hide: () => UIUtils.addClass('chat-dropdown', 'hidden'),
        toggle: () => UIUtils.toggle('chat-dropdown', 'hidden')
    };

    /**
     * Transfer animation management
     */
    static transferAnimation = {
        showCat: () => {
            UIUtils.show(['cat-animation-frame']);
            UIUtils.hide(['truck-animation-container']);
        },

        showTruck: () => {
            UIUtils.hide(['cat-animation-frame']);
            UIUtils.show(['truck-animation-container']);
            UIUtils.setStyles('truck-animation-frame', {
                width: '100%',
                height: '200px',
                border: 'none'
            });
        },

        hide: () => {
            UIUtils.hide(['cat-animation-frame', 'truck-animation-container']);
        }
    };
}

// Export for use in renderer process
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { UIUtils, UIOperations };
} else {
    // Browser environment
    window.UIUtils = UIUtils;
    window.UIOperations = UIOperations;
}

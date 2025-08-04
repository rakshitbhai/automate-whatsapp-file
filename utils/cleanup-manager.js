// cleanup-manager.js - Resource cleanup utilities

class CleanupManager {
    constructor() {
        this.resources = new Map();
    }

    /**
     * Register a resource for cleanup
     * @param {string} id - Resource identifier
     * @param {function} cleanupFn - Cleanup function
     */
    register(id, cleanupFn) {
        this.resources.set(id, cleanupFn);
    }

    /**
     * Cleanup a specific resource
     * @param {string} id - Resource identifier
     */
    cleanup(id) {
        const cleanupFn = this.resources.get(id);
        if (cleanupFn) {
            try {
                cleanupFn();
                this.resources.delete(id);
            } catch (error) {
                console.error(`Error cleaning up resource ${id}:`, error);
            }
        }
    }

    /**
     * Cleanup all registered resources
     */
    cleanupAll() {
        for (const [id, cleanupFn] of this.resources.entries()) {
            try {
                cleanupFn();
            } catch (error) {
                console.error(`Error cleaning up resource ${id}:`, error);
            }
        }
        this.resources.clear();
    }

    /**
     * Common WhatsApp socket cleanup
     * @param {object} sock - WhatsApp socket
     * @param {object} store - WhatsApp store
     * @param {function} logFn - Logging function
     */
    static cleanupWhatsAppSocket(sock, store, logFn) {
        if (sock) {
            try {
                logFn("Ending WhatsApp connection (preserving auth)...");

                if (sock.ev && typeof sock.end === "function" && !sock.destroyed) {
                    sock.end();
                } else {
                    logFn("Socket already destroyed or invalid");
                }
            } catch (err) {
                logFn(`Error closing WhatsApp connection: ${err.message}`);
            }
        }

        if (store) {
            store = null;
            logFn("Store data cleared");
        }

        return { sock: null, store: null };
    }

    /**
     * Common file watcher cleanup
     * @param {object} watcher - File watcher instance
     * @param {function} logFn - Logging function
     */
    static cleanupFileWatcher(watcher, logFn) {
        if (watcher) {
            try {
                watcher.close();
                logFn("File watcher closed");
            } catch (err) {
                logFn(`Error closing file watcher: ${err.message}`);
            }
        }
        return null;
    }

    /**
     * Common garbage collection
     * @param {function} logFn - Logging function
     */
    static runGarbageCollection(logFn) {
        if (global.gc) {
            global.gc();
            logFn("Performed garbage collection");
        }
    }

    /**
     * Common interval cleanup
     * @param {array} intervals - Array of interval IDs
     * @param {function} logFn - Logging function
     */
    static cleanupIntervals(intervals, logFn) {
        if (intervals && intervals.length > 0) {
            intervals.forEach(clearInterval);
            logFn(`Cleared ${intervals.length} intervals`);
            return [];
        }
        return intervals;
    }

    /**
     * Clean up auth directories and files
     * @param {array} paths - Array of paths to clean
     * @param {function} logFn - Logging function
     * @param {object} FileUtils - File utilities class
     */
    static cleanupAuthData(paths, logFn, FileUtils) {
        for (const { path: dirPath, description } of paths) {
            try {
                FileUtils.removeDirectory(dirPath);
                logFn(`${description} cleared`);
            } catch (error) {
                logFn(`Error clearing ${description}: ${error.message}`);
            }
        }
    }

    /**
     * Clean up specific files
     * @param {array} filePaths - Array of file paths to clean
     * @param {function} logFn - Logging function
     * @param {object} FileUtils - File utilities class
     */
    static cleanupFiles(filePaths, logFn, FileUtils) {
        for (const { path: filePath, description } of filePaths) {
            try {
                FileUtils.removeFile(filePath);
                logFn(`${description} cleared`);
            } catch (error) {
                logFn(`Error clearing ${description}: ${error.message}`);
            }
        }
    }
}

module.exports = CleanupManager;

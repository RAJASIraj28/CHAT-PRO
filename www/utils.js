/**
 * ProChat Advanced Utility Library
 * 
 * A collection of high-performance utility functions for cryptography, 
 * image processing, network diagnostics, and data manipulation.
 */

const ProUtils = (() => {

    /**
     * CRYPTOGRAPHY & SECURITY
     */
    const Crypto = {
        /**
         * Generates a secure random string for IDs
         */
        randomString: (length = 16) => {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let result = '';
            const randomValues = new Uint32Array(length);
            window.crypto.getRandomValues(randomValues);
            for (let i = 0; i < length; i++) {
                result += chars[randomValues[i] % chars.length];
            }
            return result;
        },

        /**
         * Hashes a string using SHA-256
         */
        sha256: async (message) => {
            const msgBuffer = new TextEncoder().encode(message);
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        },

        /**
         * Simple Base64 encoding for URL safety
         */
        base64UrlEncode: (str) => {
            return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
    };

    /**
     * IMAGE & MEDIA PROCESSING
     */
    const Media = {
        /**
         * Resizes and compresses an image before transmission
         */
        optimizeImage: (dataUrl, maxWidth = 1200, quality = 0.7) => {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.src = dataUrl;
            });
        },

        /**
         * Generates a thumbnail for a video data URL
         */
        generateVideoThumbnail: (videoDataUrl) => {
            return new Promise((resolve) => {
                const video = document.createElement('video');
                video.src = videoDataUrl;
                video.onloadeddata = () => {
                    video.currentTime = 1; // Seek to 1 second
                };
                video.onseeked = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth / 4;
                    canvas.height = video.videoHeight / 4;
                    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL());
                };
            });
        }
    };

    /**
     * NETWORK & DIAGNOSTICS
     */
    const Network = {
        /**
         * Measures latency to a specific URL
         */
        measureLatency: async (url) => {
            const start = performance.now();
            try {
                await fetch(url, { mode: 'no-cors', cache: 'no-cache' });
                return performance.now() - start;
            } catch (e) {
                return -1;
            }
        },

        /**
         * Checks if the browser has a stable internet connection
         */
        isOnline: () => navigator.onLine
    };

    /**
     * DATA MANIPULATION
     */
    const Data = {
        /**
         * Deep merges two objects
         */
        deepMerge: (target, source) => {
            for (const key in source) {
                if (source[key] instanceof Object && key in target) {
                    Object.assign(source[key], Data.deepMerge(target[key], source[key]));
                }
            }
            Object.assign(target || {}, source);
            return target;
        },

        /**
         * Debounces a function call
         */
        debounce: (func, wait) => {
            let timeout;
            return (...args) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        },

        /**
         * Formats file size into human-readable string
         */
        formatFileSize: (bytes) => {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }
    };

    /**
     * DATE & TIME
     */
    const Time = {
        /**
         * Returns a relative time string (e.g., "5m ago")
         */
        getRelativeTime: (timestamp) => {
            const now = Date.now();
            const diff = now - timestamp;
            const seconds = Math.floor(diff / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            if (days > 0) return `${days}d ago`;
            if (hours > 0) return `${hours}h ago`;
            if (minutes > 0) return `${minutes}m ago`;
            return 'Just now';
        }
    };

    return { Crypto, Media, Network, Data, Time };
})();

// Export for global use
window.ProUtils = ProUtils;

(() => {
    class APIError extends Error {
        constructor(message, status) {
            super(message);
            this.name = 'APIError';
            this.status = status;
        }
    }

    async function request(path, options = {}) {
        const method = options.method || 'GET';
        const headers = { Accept: 'application/json' };
        const config = {
            method,
            credentials: 'same-origin',
            headers
        };
        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
            config.body = JSON.stringify(options.body);
        }
        let response;
        try {
            response = await fetch(path, config);
        } catch (error) {
            throw new APIError('The SpiceVilla server could not be reached. Start the backend and try again.', 0);
        }
        const contentType = response.headers.get('content-type') || '';
        const payload = contentType.includes('application/json')
            ? await response.json()
            : { error: `The server returned an unexpected response (${response.status}).` };
        if (!response.ok) throw new APIError(payload.error || 'The request could not be completed.', response.status);
        return payload;
    }

    window.SpiceVillaAPI = { request, APIError };
})();

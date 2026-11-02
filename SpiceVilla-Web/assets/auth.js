(() => {
    const pageName = window.location.pathname.split('/').pop().toLowerCase();
    const ownerPages = new Set([
        'owner.html', 'pos.html', 'billing.html', 'kitchen.html',
        'orders.html', 'foods.html', 'payments.html', 'reports.html', 'customers.html'
    ]);

    function showMessage(node, message, isError = true) {
        const target = node || document.getElementById('pageStatus') || (() => {
            const status = document.createElement('p');
            status.id = 'pageStatus';
            status.className = 'auth-form-status app-toast';
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');
            document.body.appendChild(status);
            return status;
        })();
        target.textContent = message;
        target.hidden = false;
        target.classList.toggle('is-error', isError);
    }

    async function start() {
        document.querySelectorAll('[data-customer-logout]').forEach((link) => { link.hidden = true; });
        if (!window.SpiceVillaAPI) {
            if (ownerPages.has(pageName)) {
                window.location.replace('owner-login.html');
            }
            const setupStatus = document.getElementById('ownerSetupStatus');
            if (setupStatus) showMessage(setupStatus, 'The SpiceVilla server is unavailable. Start the backend and reload this page.');
            return;
        }

        if (ownerPages.has(pageName)) {
            try {
                const result = await window.SpiceVillaAPI.request('/api/me');
                if (!result.user || result.user.role !== 'owner') {
                    window.location.replace('owner-login.html');
                    return;
                }
                document.body.dataset.userRole = result.user.role;
            } catch (error) {
                if (error.status === 401 || error.status === 403) {
                    window.location.replace('owner-login.html');
                    return;
                }
                const status = document.getElementById('pageStatus');
                showMessage(status, error.message);
            }
        }

        const ownerForm = document.getElementById('ownerLoginForm');
        if (ownerForm) ownerForm.addEventListener('submit', (event) => submitLogin(event, ownerForm, 'owner'));
        const customerForm = document.getElementById('customerLoginForm');
        if (customerForm) customerForm.addEventListener('submit', (event) => submitLogin(event, customerForm, 'customer'));
        const registrationForm = document.getElementById('customerRegistrationForm');
        if (registrationForm) registrationForm.addEventListener('submit', submitRegistration);
        const ownerRegistrationForm = document.getElementById('ownerRegistrationForm');
        if (ownerRegistrationForm) {
            ownerRegistrationForm.addEventListener('submit', submitOwnerRegistration);
            loadOwnerSetup(ownerRegistrationForm);
        }

        document.querySelectorAll('[data-owner-logout], [data-customer-logout]').forEach((link) => {
            link.addEventListener('click', async (event) => {
                event.preventDefault();
                link.setAttribute('aria-busy', 'true');
                try {
                    await window.SpiceVillaAPI.request('/api/auth/logout', { method: 'POST', body: {} });
                    window.location.replace(link.href);
                } catch (error) {
                    link.removeAttribute('aria-busy');
                    showMessage(document.getElementById('pageStatus'), error.message);
                }
            });
        });

        const customerName = document.querySelector('[data-customer-name]');
        if (customerName) loadCustomerProfile(customerName);
        const googleButton = document.getElementById('googleSignInButton');
        if (googleButton) initializeGoogleSignIn(googleButton);
    }

    async function submitLogin(event, form, expectedRole) {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const status = document.getElementById('loginStatus');
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const result = await window.SpiceVillaAPI.request('/api/auth/login', {
                method: 'POST',
                body: {
                    email: form.querySelector('[autocomplete="username"]').value.trim(),
                    password: form.querySelector('[autocomplete="current-password"]').value
                }
            });
            if (result.user.role !== expectedRole) {
                await window.SpiceVillaAPI.request('/api/auth/logout', { method: 'POST', body: {} });
                throw new Error(expectedRole === 'owner'
                    ? 'This account is not an owner account.'
                    : 'This account belongs to the owner portal.');
            }
            window.location.replace(expectedRole === 'owner' ? 'owner.html' : 'customer.html');
        } catch (error) {
            showMessage(status, error.message);
        } finally {
            button.disabled = false;
        }
    }

    async function submitRegistration(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const status = document.getElementById('registrationStatus');
        const button = form.querySelector('button[type="submit"]');
        if (form.elements.password.value !== form.elements.confirmPassword.value) {
            showMessage(status, 'The passwords do not match.');
            return;
        }
        button.disabled = true;
        try {
            await window.SpiceVillaAPI.request('/api/auth/register', {
                method: 'POST',
                body: {
                    name: form.elements.name.value.trim(),
                    email: form.elements.email.value.trim(),
                    phone: form.elements.phone.value.trim(),
                    password: form.elements.password.value
                }
            });
            window.location.replace('customer.html');
        } catch (error) {
            showMessage(status, error.message);
        } finally {
            button.disabled = false;
        }
    }

    async function loadOwnerSetup(form) {
        const status = document.getElementById('ownerSetupStatus');
        try {
            const result = await window.SpiceVillaAPI.request('/api/auth/owner-setup');
            if (!result.available) {
                showMessage(status, 'Initial owner setup is unavailable here or an owner account already exists. Ask the administrator to provision another owner account.');
                return;
            }
            status.hidden = true;
            form.hidden = false;
        } catch (error) {
            showMessage(status, error.message);
        }
    }

    async function submitOwnerRegistration(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const status = document.getElementById('ownerRegistrationStatus');
        const button = form.querySelector('button[type="submit"]');
        if (form.elements.password.value !== form.elements.confirmPassword.value) {
            showMessage(status, 'The passwords do not match.');
            return;
        }
        button.disabled = true;
        try {
            await window.SpiceVillaAPI.request('/api/auth/register-owner', {
                method: 'POST',
                body: {
                    name: form.elements.name.value.trim(),
                    email: form.elements.email.value.trim(),
                    password: form.elements.password.value
                }
            });
            window.location.replace('owner.html');
        } catch (error) {
            showMessage(status, error.message);
        } finally {
            button.disabled = false;
        }
    }

    async function loadCustomerProfile(nameNode) {
        try {
            const result = await window.SpiceVillaAPI.request('/api/profile');
            nameNode.textContent = result.user.name;
            const orderCustomer = document.getElementById('orderCustomer');
            if (orderCustomer) orderCustomer.value = result.user.name;
            document.querySelectorAll('[data-customer-logout]').forEach((link) => { link.hidden = false; });
        } catch (error) {
            if (error.status !== 401) showMessage(document.getElementById('pageStatus'), error.message);
        }
    }

    async function initializeGoogleSignIn(container) {
        const status = document.getElementById('googleSignInStatus');
        const setup = document.getElementById('googleSignInSetup');
        let clientId = '';
        try {
            clientId = (await window.SpiceVillaAPI.request('/api/config')).google_client_id || '';
        } catch (error) {
            showMessage(status, error.message);
            return;
        }
        if (!clientId || clientId.startsWith('YOUR_')) {
            showMessage(status, 'Google sign-in needs a Google OAuth client ID before the button can be enabled.');
            if (setup) setup.hidden = false;
            return;
        }
        if (setup) setup.hidden = true;
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onerror = () => showMessage(status, 'Google sign-in could not load. Check your connection and try again.');
        script.onload = () => {
            if (!window.google?.accounts?.id) {
                showMessage(status, 'Google sign-in could not initialize. Reload and try again.');
                return;
            }
            window.google.accounts.id.initialize({
                client_id: clientId,
                callback: async (response) => {
                    try {
                        await window.SpiceVillaAPI.request('/api/auth/google', {
                            method: 'POST',
                            body: { credential: response.credential }
                        });
                        window.location.replace('customer.html');
                    } catch (error) {
                        showMessage(status, error.message);
                    }
                }
            });
            window.google.accounts.id.renderButton(container, {
                theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: 320
            });
        };
        document.head.appendChild(script);
    }

    document.addEventListener('DOMContentLoaded', start);
})();

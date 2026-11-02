(() => {
    const safeImage = (value) => {
        const source = String(value || '');
        return source.startsWith('/uploads/') || /^https:\/\//i.test(source) ? source : '';
    };

    document.addEventListener('DOMContentLoaded', async () => {
        const status = document.getElementById('foodDetailStatus');
        const id = Number(new URLSearchParams(window.location.search).get('id'));
        if (!Number.isSafeInteger(id) || id < 1) {
            status.textContent = 'This menu item link is invalid.';
            status.classList.add('is-error');
            return;
        }
        try {
            const result = await window.SpiceVillaAPI.request(`/api/foods/${id}`);
            const food = result.item;
            document.title = `${food.name} | SpiceVilla`;
            document.getElementById('foodDetailName').textContent = food.name;
            document.getElementById('foodDetailCategory').textContent = food.category;
            document.getElementById('foodDetailDescription').textContent = food.description || 'Freshly prepared in our kitchen.';
            document.getElementById('foodDetailPrice').textContent = `₹${Number(food.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            document.getElementById('foodDetailAvailability').textContent = food.is_available ? 'Available to order' : 'Currently unavailable';
            const image = document.getElementById('foodDetailImage');
            image.src = safeImage(food.image_url);
            image.alt = food.name;
            const addButton = document.getElementById('foodDetailAdd');
            addButton.disabled = !food.is_available;
            addButton.addEventListener('click', () => {
                window.addToCart({
                    id: Number(food.id),
                    name: food.name,
                    price: Number(food.price),
                    img: safeImage(food.image_url)
                });
            });
            document.getElementById('foodDetail').hidden = false;
            status.hidden = true;
        } catch (error) {
            status.textContent = error.message;
            status.classList.add('is-error');
        }
    });
})();

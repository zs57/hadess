/**
 * Hadith Premium Platform - Node.js Core Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    const resultsContainer = document.getElementById('hadith-results');
    const searchInput = document.getElementById('hadith-search');
    const categoriesContainer = document.getElementById('categories-container');
    const featuredText = document.getElementById('featured-text');
    const featuredSource = document.getElementById('featured-source');
    
    let currentCategory = 'all';

    async function loadHadiths(page = 1, category = 'all', query = '') {
        resultsContainer.innerHTML = Array(6).fill(0).map(() => `
            <div class="hadith-card skeleton" style="height: 250px;"></div>
        `).join('');

        try {
            // Updated API path for Node.js
            let url = `/api/hadiths?page=${page}&category=${category}`;
            if (query) url += `&q=${encodeURIComponent(query)}`;

            const response = await fetch(url);
            const result = await response.json();

            if (result.status === 'success') {
                renderCards(result.data);
            } else {
                showError(result.message || "فشل تحميل البيانات");
            }
        } catch (error) {
            console.error(error);
            showError("حدث خطأ في الاتصال بالسيرفر. تأكد من تشغيل Node.js");
        }
    }

    function renderCards(hadiths) {
        if (!hadiths || hadiths.length === 0) {
            resultsContainer.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 4rem;">
                    <i data-lucide="info" style="width: 48px; height: 48px; color: var(--accent-gold); margin-bottom: 1rem;"></i>
                    <h3>لم يتم العثور على أحاديث</h3>
                </div>`;
            lucide.createIcons();
            return;
        }

        resultsContainer.innerHTML = hadiths.map((h, index) => `
            <div class="hadith-card animate-up" style="animation-delay: ${index * 0.05}s">
                <div class="hadith-text">${h.text}</div>
                <div class="hadith-meta">
                    <span class="hadith-source">${h.source}</span>
                    <span class="hadith-chapter">${h.chapter || ''}</span>
                </div>
            </div>
        `).join('');
        lucide.createIcons();
    }

    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadHadiths(1, currentCategory, e.target.value);
        }, 500);
    });

    categoriesContainer.addEventListener('click', (e) => {
        const pill = e.target.closest('.category-pill');
        if (!pill) return;
        document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentCategory = pill.dataset.category;
        loadHadiths(1, currentCategory);
    });

    async function loadFeatured() {
        try {
            const response = await fetch('/api/hadiths?limit=1');
            const result = await response.json();
            if (result.status === 'success' && result.data.length > 0) {
                const h = result.data[0];
                featuredText.textContent = h.text;
                featuredSource.textContent = h.source;
            }
        } catch (e) {
            featuredText.textContent = "لا يمكن تحميل حديث اليوم حالياً.";
        }
    }

    function showError(msg) {
        resultsContainer.innerHTML = `<div style="grid-column: 1/-1; color: #ef4444; text-align: center; padding: 2rem;">${msg}</div>`;
    }

    loadFeatured();
    loadHadiths();
});

/**
 * Hadith Premium Platform - Core Logic
 * Handles dynamic content loading and UI interactions
 */

document.addEventListener('DOMContentLoaded', () => {
    const resultsContainer = document.getElementById('hadith-results');
    const searchInput = document.getElementById('hadith-search');
    const categoriesContainer = document.getElementById('categories-container');
    const featuredText = document.getElementById('featured-text');
    const featuredSource = document.getElementById('featured-source');
    
    let currentPage = 1;
    let currentCategory = 'all';

    /**
     * Fetch and render Hadiths
     */
    async function loadHadiths(page = 1, category = 'all', query = '') {
        resultsContainer.innerHTML = Array(6).fill(0).map(() => `
            <div class="hadith-card skeleton" style="height: 250px;"></div>
        `).join('');

        try {
            let url = `api/hadiths.php?page=${page}&category=${category}`;
            if (query) url = `api/hadiths.php?action=search&q=${encodeURIComponent(query)}`;

            const response = await fetch(url);
            const result = await response.json();

            if (result.status === 'success') {
                renderCards(result.data);
                if (result.note) {
                    console.warn(result.note);
                    // Optional: Show a subtle toast or banner
                }
            } else {
                showError(result.message || "فشل تحميل البيانات");
            }
        } catch (error) {
            console.error(error);
            showError("حدث خطأ في الاتصال بالخادم");
        }
    }

    /**
     * Render Hadith cards into the grid
     */
    function renderCards(hadiths) {
        if (!hadiths || hadiths.length === 0) {
            resultsContainer.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 4rem;">
                    <i data-lucide="info" style="width: 48px; height: 48px; color: var(--accent-gold); margin-bottom: 1rem;"></i>
                    <h3>لم يتم العثور على أحاديث</h3>
                    <p style="color: var(--text-secondary);">جرب البحث بكلمات أخرى أو تغيير التصنيف</p>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        resultsContainer.innerHTML = hadiths.map((h, index) => `
            <div class="hadith-card animate-up" style="animation-delay: ${index * 0.05}s">
                <div class="hadith-text">${h.text || 'نص الحديث غير متوفر'}</div>
                <div class="hadith-meta">
                    <span class="hadith-source"><i data-lucide="bookmark" style="width: 14px; height: 14px; display: inline; vertical-align: middle; margin-left: 5px;"></i> ${h.source || 'المصدر'}</span>
                    <span class="hadith-chapter">${h.chapter || ''}</span>
                </div>
            </div>
        `).join('');
        
        lucide.createIcons();
    }

    /**
     * Debounced Search
     */
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadHadiths(1, currentCategory, e.target.value);
        }, 500);
    });

    /**
     * Category selection
     */
    categoriesContainer.addEventListener('click', (e) => {
        const pill = e.target.closest('.category-pill');
        if (!pill) return;

        document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        
        currentCategory = pill.dataset.category;
        loadHadiths(1, currentCategory);
    });

    function showError(msg) {
        resultsContainer.innerHTML = `<div style="grid-column: 1/-1; color: #ef4444; text-align: center; padding: 2rem;">${msg}</div>`;
    }

    /**
     * Load Featured Hadith
     */
    async function loadFeatured() {
        try {
            const response = await fetch('api/hadiths.php?page=1&limit=1');
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

    // Initial Load
    loadFeatured();
    loadHadiths();
});

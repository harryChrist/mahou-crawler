const express = require('express');

module.exports = (providers) => {
    const router = express.Router();

    const findProviderByUrl = (url) => {
        const objectProviders = Object.values(providers);
        return objectProviders.find(provider => url.startsWith(provider.baseUrl));
    }

    // Rota para buscar novels
    router.get('/search', async (req, res) => {
        const { type, q } = req.query;
        if (!q || !type) {
            return res.status(400).json({ error: 'Missing required parameters'  });
        }
        try {
            const provider = providers[type.toLowerCase()];
            if (!provider) {
                return res.status(404).json({ error: 'Provider not found' });
            }
            const results = await provider.searchNovel(q);
            res.status(200).json(results);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Rota para obter informações de uma novel
    router.get('/chapters', async (req, res) => {
        const { type, url } = req.query;
        try {
            let provider;
            if (type) {
                provider = providers[type.toLowerCase()];
            } else {
                provider = findProviderByUrl(url);
            }
            if (!provider) {
                return res.status(404).json({ error: 'Provider not found' });
            }
            const results = await provider.readNovelInfo(url);
            res.status(200).json(results);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Rota para obter o conteúdo de um capítulo
    router.get('/chapter-content', async (req, res) => {
        const { type, url, image } = req.query;
        try {
            let provider;
            if (type) {
                provider = providers[type.toLowerCase()];
            } else {
                provider = findProviderByUrl(url);
            }
            if (!provider) {
                return res.status(404).json({ error: 'Provider not found' });
            }
            const results = await provider.downloadChapterBody(url, Boolean(image));
            res.status(200).json(results);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/providers', (req, res) => {
        const providerList = Object.values(providers).map(config => ({
            name: config.name,
            language: config.language,
            baseUrl: config.baseUrl,
        }));

        res.status(200).json(providerList);
    });

    // Rota para obter os últimos lançamentos
    router.get('/latest', async (req, res) => {
        const { type } = req.query;
        try {
            const provider = providers[type.toLowerCase()];
            if (!provider) {
                return res.status(404).json({ error: 'Provider not found' });
            }
            const results = await provider.getLatestReleases();
            res.status(200).json(results);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};

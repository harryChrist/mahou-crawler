const express = require('express');

module.exports = (providers) => {
    const router = express.Router();

    // Rota para buscar novels
    router.get('/search', async (req, res) => {
        const { site, titulo } = req.query;
        try {
            const provider = providers[site.toLowerCase()];
            if (!provider) {
                return res.status(404).json({ error: 'Provider not found' });
            }
            const results = await provider.searchNovel(titulo);
            res.status(200).json(results);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Rota para obter informações de uma novel
    router.get('/chapters', async (req, res) => {
        const { site, url } = req.query;
        try {
            const provider = providers[site.toLowerCase()];
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
        const { site, url, image } = req.query;
        try {
            const provider = providers[site.toLowerCase()];
            if (!provider) {
                return res.status(404).json({ error: 'Provider not found' });
            }
            const results = await provider.downloadChapterBody(url, Boolean(image));
            res.status(200).json(results);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Rota para obter todas as informações de uma novel
    router.get('/all', async (req, res) => {
        const { site, link } = req.query;
        try {
            const provider = providers[site.toLowerCase()];
            if (!provider) {
                return res.status(404).json({ error: 'Provider not found' });
            }
            const results = await provider.getAll(link);
            res.status(200).json(results);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/providers', (req, res) => {
        res.status(200).json(providers);
    })

    return router;
};

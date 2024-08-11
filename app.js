require('dotenv').config();
require('module-alias/register');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const routes = require('@/routes');
const bodyParser = require('body-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const htmlParser = require('node-html-parser');
const cors = require('cors');

// Função para carregar arquivos JavaScript de subpastas recursivamente
const loadProvidersFromDirectories = (dir, providers) => {
    const items = fs.readdirSync(dir);

    items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            // Se for uma pasta, navegue recursivamente
            loadProvidersFromDirectories(fullPath, providers);
        } else if (stat.isFile() && item.endsWith('.js')) {
            // Se for um arquivo JS, carregue o módulo
            const provider = require(fullPath);
            if (provider && provider.name) {
                providers[provider.name.toLowerCase()] = provider;
            }
        }
    });
};

// Inicializando o objeto de providers
const providers = {};
const sourceDir = path.join(__dirname, 'src/source');

// Carregar crawlers dinamicamente das subpastas
loadProvidersFromDirectories(sourceDir, providers);

app.use(express.json());
app.use('/api', routes(providers));
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

const genAI = new GoogleGenerativeAI("AIzaSyDA0kgqMeItrWFz1FUKDTTriRUQsOSWfP8");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

app.post('/api/translate', async (req, res) => {
    const { textContent, parts = 5 } = req.body;

    if (!textContent) {
        return res.status(400).json({ error: 'Text content is required' });
    }

    try {
        // Remove quebras de linha e espaços desnecessários mantendo uma linha por linha
        const lines = textContent
            .split('\n')
            .map(line => line.trim())  // Remove espaços no início e fim de cada linha
            .filter(line => line !== '')  // Remove linhas completamente vazias
            .join('\n');  // Junta as linhas mantendo as quebras de linha

        const paragraphs = lines.split('\n').filter(line => line.trim() !== '');

        const chunkSize = Math.ceil(paragraphs.length / parts);
        const chunks = [];
        for (let i = 0; i < paragraphs.length; i += chunkSize) {
            chunks.push(paragraphs.slice(i, i + chunkSize).join('\n'));
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');

        for (const chunk of chunks) {
            const result = await model.generateContent(`Traduza para o Português Brasileiro: ${chunk}`);
            const translatedText = result.response.text();
            res.write(`${translatedText}\n`); // Mantém uma quebra de linha entre cada bloco traduzido
        }

        res.end();
    } catch (error) {
        console.error('Translation error:', error);
        res.status(500).json({ error: error.message });
    }
});

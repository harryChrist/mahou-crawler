class SearchResult {
    constructor({
        title,
        url,
        info = "",
        ...kwargs
    }) {
        this.title = String(title);
        this.url = String(url);
        this.info = String(info);

        // Adiciona quaisquer outras propriedades fornecidas
        Object.assign(this, kwargs);
    }
}

class CombinedSearchResult {
    constructor({
        id,
        title,
        novels = [],
        ...kwargs
    }) {
        this.id = id;
        this.title = String(title);
        this.novels = novels;

        // Adiciona quaisquer outras propriedades fornecidas
        Object.assign(this, kwargs);
    }
}

module.exports = { SearchResult, CombinedSearchResult };

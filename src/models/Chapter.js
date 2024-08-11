class Chapter {
    constructor({
        id,
        url = "",
        title = "",
        volume = null,
        volumeTitle = null,
        body = null,
        images = {},
        success = false,
        ...kwargs
    }) {
        this.id = id;
        this.url = url;
        this.title = title;
        this.volume = volume;
        this.volumeTitle = volumeTitle;
        this.body = body;
        this.images = images;
        this.success = success;

        // Adiciona quaisquer outras propriedades fornecidas
        Object.assign(this, kwargs);
    }

    static withoutBody(item) {
        const result = { ...item };
        result.body = null;
        return result;
    }
}

module.exports = Chapter;

class Volume {
    constructor({
        id,
        title = "",
        startChapter = null,
        finalChapter = null,
        chapterCount = null,
        ...kwargs
    }) {
        this.id = id;
        this.title = title;
        this.startChapter = startChapter;
        this.finalChapter = finalChapter;
        this.chapterCount = chapterCount;

        // Adiciona quaisquer outras propriedades fornecidas
        Object.assign(this, kwargs);
    }
}

module.exports = Volume;

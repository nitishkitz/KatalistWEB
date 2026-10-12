const corrections: Record<string, string> = {
  documnts: "documents", douncments: "documents", documnets: "documents",
  docuemnts: "documents", documets: "documents", documetns: "documents",
};

/** Correct ordinary words only; preserve names, links, mentions and identifiers. */
export function correctCommonTypos(text: string): string {
  return text.split(/(https?:\/\/\S+|www\.\S+|\S+@\S+|[@#][\w.-]+)/gi)
    .map((part, index) => index % 2 ? part : part.replace(/\b[a-z]+\b/gi, (word, offset: number) => {
      if (/[@#/_\-.]/.test(part[offset - 1] ?? "") || /[/_\-.]/.test(part[offset + word.length] ?? "")) return word;
      const replacement = corrections[word.toLowerCase()];
      if (!replacement) return word;
      if (word === word.toUpperCase()) return replacement.toUpperCase();
      return /^[A-Z]/.test(word) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
    })).join("");
}

// Téléchargement d'un fichier JSON créé dans le navigateur (export, version mise de côté).
export const downloadJSON = (fileName: string, value: unknown): void => {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

// ================================================
// FILE: src/services/drive/picker.ts
// Sélecteur de fichiers Google (Picker) et téléchargement d'un fichier choisi.
// Découpé de googleDriveService.ts sans changement de comportement.
// ================================================
import { CLIENT_ID, PickerCallbackData, PickerApi, googleWindow, GAPI_SRC, loadScript, waitFor, getAccessToken, authedFetch } from './session';

// --- GOOGLE PICKER (sélection de fichiers existants sur le Drive de l'utilisateur) ---
//
// Le scope `drive.file` ne donne accès qu'aux fichiers créés par l'app : impossible de
// parcourir un dossier existant par chemin. Le Picker contourne ça proprement, SANS élargir
// le scope OAuth : l'utilisateur choisit lui-même le fichier dans une fenêtre native Google,
// et l'app reçoit un accès scopé à *exactement* ce qui a été sélectionné (persistant, donc
// pas besoin de rouvrir le Picker à chaque session pour un même fichier déjà choisi).
let pickerApiLoaded = false;

const loadPickerApi = async (): Promise<PickerApi> => {
  // api.js n'est chargé qu'ici, à la première ouverture du Picker.
  await loadScript(GAPI_SRC);
  const gapi = await waitFor(() => googleWindow().gapi, 'gapi');
  if (!pickerApiLoaded) {
    await new Promise<void>((resolve, reject) => {
      gapi.load('picker', { callback: resolve, onerror: reject });
    });
    pickerApiLoaded = true;
  }
  return googleWindow().google!.picker;
};

export interface PickedDriveFile {
  id: string;
  name: string;
  mimeType: string;
}

/**
 * Ouvre le sélecteur Google Drive natif, restreint aux PDF et images (fiches de paie).
 * Résout avec le fichier choisi, ou `null` si l'utilisateur annule.
 *
 * `pickerApiKey` est la clé API Google Cloud créée par l'utilisateur (Cloud Console →
 * Identifiants → Clé API, restreinte à l'API Picker) — distincte du CLIENT_ID OAuth,
 * exigée par l'API Picker elle-même.
 */
export const openDrivePicker = async (pickerApiKey: string): Promise<PickedDriveFile | null> => {
  if (!pickerApiKey) throw new Error('PICKER_API_KEY_MISSING');
  const [picker, token] = await Promise.all([loadPickerApi(), getAccessToken()]);

  return new Promise((resolve, reject) => {
    const view = new picker.DocsView(picker.ViewId.DOCS)
      .setMimeTypes('application/pdf,image/png,image/jpeg,image/webp')
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const pickerInstance = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      // Indispensable avec le scope drive.file : sans l'ID du projet (le préfixe
      // numérique du CLIENT_ID), le fichier choisi apparaît sélectionnable dans le
      // Picker mais l'accès n'est en réalité JAMAIS accordé — la lecture suivante
      // échoue avec un 404 "fileId" alors que le fichier existe bel et bien.
      .setAppId(CLIENT_ID.split('-')[0])
      .setDeveloperKey(pickerApiKey)
      .setCallback((data: PickerCallbackData) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name, mimeType: doc.mimeType } : null);
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        } else if (data.action === 'error') {
          // Sans cette branche, une erreur interne du Picker laisserait la promesse pendante
          // à jamais — bouton "Importer" mort jusqu'au rechargement de la page.
          reject(new Error('PICKER_ERROR'));
        }
      })
      .build();
    try {
      pickerInstance.setVisible(true);
    } catch (e) {
      reject(e);
    }
  });
};

/**
 * Télécharge un fichier sélectionné via le Picker et le renvoie encodé en base64, prêt à
 * être envoyé à l'API Gemini (`inline_data`). Le fichier n'est jamais recopié sur Drive :
 * on ne fait que le lire, pour l'envoyer directement au fournisseur d'extraction.
 */
export const downloadFileAsBase64 = async (fileId: string): Promise<string> => {
  const res = await authedFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  const buffer = await res.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  // Par blocs pour éviter de dépasser la limite d'arguments de String.fromCharCode sur
  // un gros PDF (au-delà d'environ 65k octets passés d'un coup selon les moteurs JS).
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};


const CLIENT_ID = '763862877733-hl1an9vcn0ibnoq2iq035927528mimd5.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'suivi_epargne.json';

let tokenClient: any;
let gapiInited = false;
let gisInited = false;

// Initialisation des API Google
export const initGoogleApi = async (): Promise<void> => {
  return new Promise((resolve) => {
    const gapiLoaded = () => {
      (window as any).gapi.load('client', async () => {
        await (window as any).gapi.client.init({
          // Note: API Key is not strictly needed here if we rely on Access Token for Drive, 
          // but discoveryDocs are needed.
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
        });
        gapiInited = true;
        checkResolve();
      });
    };

    const gisLoaded = () => {
      tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '', // defined at request time
      });
      gisInited = true;
      checkResolve();
    };

    const checkResolve = () => {
      if (gapiInited && gisInited) resolve();
    };

    if ((window as any).gapi) gapiLoaded();
    if ((window as any).google) gisLoaded();
  });
};

// Connexion utilisateur
export const handleAuthClick = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    tokenClient.callback = async (resp: any) => {
      if (resp.error) {
        reject(resp);
      }
      resolve();
    };

    // Vérifie si un token existe ou demande un nouveau
    if ((window as any).gapi.client.getToken() === null) {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      tokenClient.requestAccessToken({ prompt: '' });
    }
  });
};

// Déconnexion
export const handleSignOut = () => {
  const token = (window as any).gapi.client.getToken();
  if (token !== null) {
    (window as any).google.accounts.oauth2.revoke(token.access_token);
    (window as any).gapi.client.setToken('');
  }
};

// Recherche du fichier de sauvegarde
export const findConfigFile = async (): Promise<string | null> => {
  try {
    const response = await (window as any).gapi.client.drive.files.list({
      q: `name = '${FILE_NAME}' and trashed = false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });
    const files = response.result.files;
    if (files && files.length > 0) {
      return files[0].id;
    }
    return null;
  } catch (err) {
    console.error('Erreur recherche fichier Drive', err);
    throw err;
  }
};

// Lecture du contenu du fichier
export const readConfigFile = async (fileId: string): Promise<any> => {
  try {
    const response = await (window as any).gapi.client.drive.files.get({
      fileId: fileId,
      alt: 'media',
    });
    return response.result; // gapi retourne déjà l'objet JSON parsé si le content-type est application/json
  } catch (err) {
    console.error('Erreur lecture fichier Drive', err);
    throw err;
  }
};

// Création du fichier initial
export const createConfigFile = async (data: any): Promise<string> => {
  try {
    const fileContent = JSON.stringify(data, null, 2);
    const metadata = {
      name: FILE_NAME,
      mimeType: 'application/json',
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([fileContent], { type: 'application/json' }));

    const accessToken = (window as any).gapi.client.getToken().access_token;
    
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
      body: form,
    });
    
    const result = await response.json();
    return result.id;
  } catch (err) {
    console.error('Erreur création fichier Drive', err);
    throw err;
  }
};

// Mise à jour du fichier (Sauvegarde)
export const updateConfigFile = async (fileId: string, data: any): Promise<void> => {
  try {
    const fileContent = JSON.stringify(data, null, 2);
    
    // Pour une mise à jour simple de contenu, on utilise fetch avec la méthode PATCH sur l'endpoint upload
    const accessToken = (window as any).gapi.client.getToken().access_token;
    
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: new Headers({ 
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      }),
      body: fileContent,
    });
  } catch (err) {
    console.error('Erreur mise à jour fichier Drive', err);
    throw err;
  }
};

import React, { useState, useEffect } from 'react';
import { Button } from './Button';
import { generateDreamImage, editSavingsImage } from '../services/geminiService';
import { Wand2, ImagePlus, Upload, Download } from 'lucide-react';

interface AIStudio {
  hasSelectedApiKey: () => Promise<boolean>;
  openSelectKey: () => Promise<void>;
}

export const GoalVisualizer: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'generate' | 'edit'>('generate');
  
  // Generation State with Persistence
  const [genPrompt, setGenPrompt] = useState(() => localStorage.getItem('goal_prompt') || '');
  const [genSize, setGenSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('goal_prompt', genPrompt);
  }, [genPrompt]);

  // Edit State
  const [editPrompt, setEditPrompt] = useState('');
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [sourceMimeType, setSourceMimeType] = useState<string>('');
  const [editedImage, setEditedImage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // --- Handlers for Generation (Nano Banana Pro) ---
  const handleGenerate = async () => {
    setGenError(null);
    if (!genPrompt.trim()) return;

    try {
      setIsGenerating(true);
      
      const aiStudio = (window as any).aistudio as AIStudio | undefined;

      // Mandatory API Key Selection for Veo/Pro Image models
      if (aiStudio) {
        const hasKey = await aiStudio.hasSelectedApiKey();
        if (!hasKey) {
          await aiStudio.openSelectKey();
          // Assuming successful selection per instructions, no delay check loop
        }
      }

      // The selected API key is available via process.env.API_KEY automatically.
      // The generateDreamImage service will initialize a fresh instance using it.
      const resultUrl = await generateDreamImage({ prompt: genPrompt, size: genSize });
      setGeneratedImage(resultUrl);

    } catch (err: any) {
      console.error(err);
      const aiStudio = (window as any).aistudio as AIStudio | undefined;
      
      if (err.message?.includes("Requested entity was not found") && aiStudio) {
          // Retry key selection logic if the entity was not found (API key invalid/unconfigured)
          try {
             await aiStudio.openSelectKey();
             setGenError("Clé API introuvable. Veuillez réessayer.");
          } catch (e) {
             setGenError("Erreur lors de la sélection de la clé API.");
          }
      } else {
        setGenError(err.message || "Une erreur est survenue lors de la génération.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // --- Handlers for Editing (Nano Banana) ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Extract base64 part
        const base64 = result.split(',')[1];
        setSourceImage(base64);
        setSourceMimeType(file.type);
        setEditedImage(null); // Reset result
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEdit = async () => {
    setEditError(null);
    if (!editPrompt.trim() || !sourceImage) return;

    try {
      setIsEditing(true);
      const resultUrl = await editSavingsImage({
        prompt: editPrompt,
        base64Image: sourceImage,
        mimeType: sourceMimeType
      });
      setEditedImage(resultUrl);
    } catch (err: any) {
      setEditError("Erreur lors de l'édition. Vérifiez que votre demande est claire.");
    } finally {
      setIsEditing(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="border-b border-slate-200 flex">
        <button
          onClick={() => setActiveTab('generate')}
          className={`flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 ${
            activeTab === 'generate' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Wand2 className="w-4 h-4" />
          Générer un Objectif (Pro)
        </button>
        <button
          onClick={() => setActiveTab('edit')}
          className={`flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 ${
            activeTab === 'edit' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <ImagePlus className="w-4 h-4" />
          Retoucher une Photo
        </button>
      </div>

      <div className="p-6">
        {/* GENERATION TAB */}
        {activeTab === 'generate' && (
          <div className="space-y-4">
            <div className="bg-indigo-50 p-4 rounded-lg text-sm text-indigo-800 mb-4">
              Visualisez votre prochain achat immobilier, votre voyage de rêve ou votre future voiture avec le modèle <strong>Nano Banana Pro</strong>.
            </div>
            
            <div className="flex flex-col md:flex-row gap-4">
               <div className="flex-1">
                 <label className="block text-sm font-medium text-slate-700 mb-1">Votre Rêve</label>
                 <textarea
                   value={genPrompt}
                   onChange={(e) => setGenPrompt(e.target.value)}
                   placeholder="Une maison moderne avec piscine au bord de la mer Méditerranée..."
                   className="w-full p-3 border border-slate-300 rounded-lg h-24 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                 />
               </div>
               <div className="w-full md:w-48">
                 <label className="block text-sm font-medium text-slate-700 mb-1">Qualité</label>
                 <select 
                   value={genSize}
                   onChange={(e) => setGenSize(e.target.value as any)}
                   className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                 >
                   <option value="1K">1K (Rapide)</option>
                   <option value="2K">2K (Détaillé)</option>
                   <option value="4K">4K (Ultra HD)</option>
                 </select>
                 <Button 
                   onClick={handleGenerate} 
                   className="w-full mt-4" 
                   isLoading={isGenerating}
                   disabled={!genPrompt}
                 >
                   Générer
                 </Button>
               </div>
            </div>

            {genError && <p className="text-red-600 text-sm mt-2">{genError}</p>}
            
            {generatedImage && (
              <div className="mt-6 rounded-lg overflow-hidden border border-slate-200">
                <img src={generatedImage} alt="Generated Goal" className="w-full h-auto" />
                <div className="p-2 bg-slate-50 flex justify-end">
                   <a href={generatedImage} download="mon-objectif.png" className="text-indigo-600 text-sm font-medium flex items-center gap-1">
                     <Download className="w-4 h-4" /> Télécharger
                   </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* EDIT TAB */}
        {activeTab === 'edit' && (
          <div className="space-y-4">
             <div className="bg-emerald-50 p-4 rounded-lg text-sm text-emerald-800 mb-4">
              Utilisez <strong>Nano Banana</strong> pour modifier une photo existante (ex: "Ajoute un filtre rétro", "Enlève l'objet à gauche").
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">1. Image Source</label>
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:bg-slate-50 transition-colors relative">
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  {sourceImage ? (
                     <div className="relative h-40 flex items-center justify-center">
                       <img src={`data:${sourceMimeType};base64,${sourceImage}`} className="max-h-full max-w-full rounded shadow-sm" alt="Source" />
                     </div>
                  ) : (
                    <div className="py-8">
                       <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                       <span className="text-slate-500 text-sm">Cliquez pour uploader une image</span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">2. Votre Retouche</label>
                <textarea
                   value={editPrompt}
                   onChange={(e) => setEditPrompt(e.target.value)}
                   placeholder="Ex: Rends cette photo plus lumineuse et ensoleillée..."
                   className="w-full p-3 border border-slate-300 rounded-lg h-32 focus:ring-2 focus:ring-emerald-500 outline-none resize-none mb-4"
                 />
                 <Button 
                   onClick={handleEdit} 
                   className="w-full bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500" 
                   isLoading={isEditing}
                   disabled={!sourceImage || !editPrompt}
                 >
                   Retoucher
                 </Button>
                 {editError && <p className="text-red-600 text-sm mt-2">{editError}</p>}
              </div>
            </div>

            {editedImage && (
               <div className="mt-8">
                 <h4 className="text-md font-medium text-slate-800 mb-2">Résultat</h4>
                 <div className="rounded-lg overflow-hidden border border-slate-200">
                    <img src={editedImage} alt="Edited Result" className="w-full h-auto" />
                 </div>
               </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
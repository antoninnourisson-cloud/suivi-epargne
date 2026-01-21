
import { GoogleGenAI } from "@google/genai";
import { ImageGenerationConfig, ImageEditConfig } from '../types';

/**
 * Generates an image using Gemini 3 Pro Image Preview ("Nano Banana Pro")
 * Requires user-selected API key via window.aistudio
 */
export const generateDreamImage = async (config: ImageGenerationConfig): Promise<string> => {
  // Always create a new instance right before making an API call to use the most up-to-date API key.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: {
      parts: [
        { text: config.prompt }
      ]
    },
    config: {
      imageConfig: {
        imageSize: config.size,
        aspectRatio: "16:9" // Good for visualization
      }
    }
  });

  // Find the image part in response candidates as per guidelines
  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  }
  
  throw new Error("Aucune image générée.");
};

/**
 * Edits an image using Gemini 2.5 Flash Image ("Nano Banana")
 * Uses the default process.env.API_KEY
 */
export const editSavingsImage = async (config: ImageEditConfig): Promise<string> => {
  // Always create a new instance right before making an API call.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          inlineData: {
            data: config.base64Image,
            mimeType: config.mimeType
          }
        },
        { text: config.prompt }
      ]
    }
  });

  // Iterate through parts to find the image result
  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  }

  throw new Error("Impossible d'éditer l'image.");
};

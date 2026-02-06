import React, { useState, useRef, useEffect } from 'react';
import { SavingsAccount, Expense, ChatMessage, FiscalConfig, WorkBenefits } from '../types';
import { generateFinancialAdvice } from '../services/geminiService';
import { Send, Bot, User, Trash2, Loader2, BrainCircuit } from 'lucide-react';
import { Button } from './Button';

interface AIAdvisorProps {
  accounts: SavingsAccount[];
  expenses: Expense[];
  config: any;
  chatHistory: ChatMessage[];
  onUpdateHistory: (history: ChatMessage[]) => void;
  fiscalConfig: FiscalConfig; // Ajout prop
  workBenefits: WorkBenefits;
}

export const AIAdvisor: React.FC<AIAdvisorProps> = ({ accounts, expenses, config, chatHistory, onUpdateHistory, fiscalConfig, workBenefits }) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [history]);

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    // CORRECTION 1 : Ajout de l'ID et utilisation de 'user'
    const userMessage: ChatMessage = { 
      id: Date.now().toString(), 
      role: 'user', 
      content: input, 
      timestamp: Date.now() 
    };
    
    const newHistory = [...history, userMessage];
    onSaveHistory(newHistory);
    setInput('');
    setIsLoading(true);

    const responseText = await generateFinancialAdvice(input, {
      accounts,
      expenses,
      config,
      history: chatHistory,
      fiscalConfig,
      workBenefits // <--- C'EST L'AJOUT MANQUANT
    });

    const aiMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'model',
      content: responseText,
      timestamp: Date.now()
    };

    onUpdateHistory([...newHistory, aiMsg]);
    setIsLoading(false);
  };

      // CORRECTION 2 : Ajout de l'ID et utilisation de 'model' (pas 'assistant')
      const aiMessage: ChatMessage = { 
        id: (Date.now() + 1).toString(), 
        role: 'model', 
        content: response, 
        timestamp: Date.now() 
      };
      
      onSaveHistory([...newHistory, aiMessage]);
    } catch (error) {
      console.error(error);
      const errorMessage: ChatMessage = { 
        id: Date.now().toString(),
        role: 'model', 
        content: "Désolé, je ne peux pas répondre pour le moment.", 
        timestamp: Date.now() 
      };
      onSaveHistory([...newHistory, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px] bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="p-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50 rounded-t-xl">
        <div className="p-2 bg-indigo-100 rounded-lg">
          <Bot className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-800">Conseiller Financier IA</h3>
          <p className="text-xs text-slate-500">Expertise • Données Temps Réel</p>
        </div>
      </div>

      {/* Zone de Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50">
        {chatHistory.length === 0 && (
          <div className="text-center py-20 opacity-60">
            <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Bot className="w-10 h-10 text-indigo-500" />
            </div>
             <p className="text-slate-600 font-bold text-lg">Bonjour !</p>
            <p className="text-sm text-slate-500 max-w-xs mx-auto mt-2">
              Je connais vos finances par cœur (soldes, charges, fiscalité).
              Posez-moi une question sur votre stratégie.
            </p>
          </div>
        )}
        
        {chatHistory.map((msg) => (
          <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-slate-700 text-white' : 'bg-indigo-600 text-white'}`}>
               {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm whitespace-pre-wrap ${msg.role === 'user' ? 'bg-white text-slate-800 rounded-tr-none border border-slate-100' : 'bg-indigo-600 text-indigo-50 rounded-tl-none shadow-indigo-200'}`}>
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 rounded-2xl rounded-tl-none p-4 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
              <span className="text-xs text-slate-500">Analyse de vos finances en cours...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-slate-100 bg-white rounded-b-xl">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Ex: Puis-je me permettre ce voyage ?"
            className="flex-1 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
          />
          <button
            onClick={handleSendMessage}
            disabled={isLoading || !input.trim()}
            className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
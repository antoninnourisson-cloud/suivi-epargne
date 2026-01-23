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
  }, [chatHistory, isLoading]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: Date.now()
    };

    const newHistory = [...chatHistory, userMsg];
    onUpdateHistory(newHistory);
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

  const handleClear = () => {
    if(confirm("Effacer tout l'historique de conversation ?")) {
      onUpdateHistory([]);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
      {/* En-tête */}
      <div className="bg-indigo-900 p-4 flex justify-between items-center text-white shadow-md z-10">
        <div className="flex items-center gap-3">
          <div className="bg-white/10 p-2 rounded-lg backdrop-blur-sm">
            <BrainCircuit className="w-6 h-6 text-indigo-300" />
          </div>
          <div>
            <h3 className="font-bold text-sm">Conseiller Patrimonial IA</h3>
            <p className="text-[10px] text-indigo-300">Analyse basée sur vos <strong>{accounts.length} comptes</strong></p>
          </div>
        </div>
        <button onClick={handleClear} className="p-2 hover:bg-white/10 rounded-lg text-indigo-300 hover:text-white transition-colors" title="Oublier la conversation">
          <Trash2 className="w-4 h-4" />
        </button>
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
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center"><Loader2 className="w-4 h-4 text-white animate-spin" /></div>
            <div className="bg-indigo-50 px-4 py-3 rounded-2xl rounded-tl-none text-xs text-indigo-700 font-bold flex items-center gap-2">
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></span>
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce delay-100"></span>
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce delay-200"></span>
              Analyse en cours...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Zone de Saisie */}
      <div className="p-4 bg-white border-t border-slate-200">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-3 relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ex: Est-ce prudent de mettre 500€ sur mon PEA ce mois-ci ?"
            className="flex-1 bg-slate-100 border-none rounded-xl pl-4 pr-4 py-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-medium text-slate-700 placeholder:text-slate-400"
            disabled={isLoading}
          />
          <Button type="submit" disabled={isLoading || !input.trim()} className="rounded-xl w-14 flex justify-center items-center shadow-lg shadow-indigo-200">
            <Send className="w-5 h-5" />
          </Button>
        </form>
      </div>
    </div>
  );
};
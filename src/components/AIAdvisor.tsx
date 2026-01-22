import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, Loader2, Sparkles } from 'lucide-react';
import { SavingsAccount, Expense, ChatMessage } from '../types';
import { generateFinancialAdvice, ComputedFinancials } from '../services/geminiService';

interface AIAdvisorProps {
  accounts: SavingsAccount[];
  expenses: Expense[];
  config: any;
  history: ChatMessage[];
  onSaveHistory: (history: ChatMessage[]) => void;
  computedData: ComputedFinancials;
}

export const AIAdvisor: React.FC<AIAdvisorProps> = ({ 
  accounts, 
  expenses, 
  config, 
  history, 
  onSaveHistory,
  computedData 
}) => {
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

    try {
      const response = await generateFinancialAdvice(input, {
        accounts,
        expenses,
        config,
        history,
        computed: computedData
      });

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

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {history.length === 0 && (
          <div className="text-center text-slate-400 mt-10 space-y-2">
            <Sparkles className="w-8 h-8 mx-auto opacity-50" />
            <p className="text-sm">Je connais vos comptes et votre budget.<br/>Posez-moi une question.</p>
          </div>
        )}
        
        {history.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl p-4 ${
              msg.role === 'user' 
                ? 'bg-indigo-600 text-white rounded-tr-none' 
                : 'bg-slate-100 text-slate-800 rounded-tl-none'
            }`}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
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
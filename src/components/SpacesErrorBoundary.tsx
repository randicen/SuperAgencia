import React from 'react';

type SpacesErrorBoundaryProps = {
    children: React.ReactNode;
};

type SpacesErrorBoundaryState = {
    hasError: boolean;
    errorMessage: string | null;
};

class SpacesErrorBoundary extends React.Component<SpacesErrorBoundaryProps, SpacesErrorBoundaryState> {
    state: SpacesErrorBoundaryState = {
        hasError: false,
        errorMessage: null,
    };

    static getDerivedStateFromError(error: Error): SpacesErrorBoundaryState {
        return {
            hasError: true,
            errorMessage: error.message || 'Espacios fallo al renderizar.',
        };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('[SpacesErrorBoundary]', error, errorInfo);
    }

    private handleRetry = () => {
        this.setState({ hasError: false, errorMessage: null });
    };

    private handleResetPreferences = () => {
        localStorage.removeItem('lista_column_order');
        localStorage.removeItem('lista_columns');
        this.handleRetry();
        window.location.reload();
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        return (
            <div className="flex-1 bg-[#F4F5F8] flex items-center justify-center p-6">
                <div className="max-w-xl w-full bg-white border border-red-100 rounded-[2rem] p-8 shadow-xl shadow-slate-200/50 space-y-5">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-200">
                            <i className="fa-solid fa-triangle-exclamation"></i>
                        </div>
                        <div className="space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-red-600">Espacios fallo al abrir</p>
                            <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">La vista no pudo renderizar</h2>
                            <p className="text-sm font-bold text-slate-500 leading-relaxed">
                                Se capturo el error para evitar la pantalla blanca completa. Puedes reintentar o limpiar las preferencias locales de esta vista.
                            </p>
                            {this.state.errorMessage && (
                                <p className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-600 break-words">
                                    {this.state.errorMessage}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={this.handleRetry}
                            className="flex-1 py-3 rounded-2xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest"
                        >
                            Reintentar
                        </button>
                        <button
                            type="button"
                            onClick={this.handleResetPreferences}
                            className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest"
                        >
                            Limpiar preferencias
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default SpacesErrorBoundary;

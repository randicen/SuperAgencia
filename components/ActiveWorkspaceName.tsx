import React from 'react';
import { useSpaces } from '../contexts/SpacesContext';

const ActiveWorkspaceName: React.FC = () => {
    const { state } = useSpaces();
    const activeWorkspace = state.workspaces.find(w => w.id === state.activeWorkspaceId) || state.workspaces[0];

    return (
        <span className="hidden md:inline text-slate-400">
            {activeWorkspace ? activeWorkspace.nombre : 'Espacio de Trabajo'}
        </span>
    );
};

export default ActiveWorkspaceName;

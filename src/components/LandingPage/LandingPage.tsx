import React from 'react';

interface LandingPageProps {
  onStart: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onStart }) => {
  return (
    <div className="flex items-center justify-center h-screen w-screen bg-gradient-to-br from-blue-500 to-purple-600 dark:from-gray-800 dark:to-gray-900">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-white mb-8">Hello</h1>
        <button
          onClick={onStart}
          className="px-8 py-3 bg-white text-blue-600 font-semibold rounded-lg hover:bg-gray-50 transition-colors duration-200 shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-300"
          data-testid="landing-start-button"
        >
          Start
        </button>
      </div>
    </div>
  );
};

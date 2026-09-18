const BottomToolbar = () => {
  return (
    <div
      role="toolbar"
      aria-label="Mobile toolbar"
      className="fixed bottom-0 left-0 right-0 z-[1030] flex h-[60px] items-center justify-around border-t border-gray-200 bg-white md:hidden dark:border-gray-700 dark:bg-gray-800"
    >
      <button
        className="text-blue-600 no-underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        data-testid="bottom-toolbar-todo-button"
      >
        Todo
      </button>
      <button
        className="text-blue-600 no-underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        data-testid="bottom-toolbar-mobile-button"
      >
        Mobile
      </button>
      <button
        className="text-blue-600 no-underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        data-testid="bottom-toolbar-toolbar-button"
      >
        Toolbar
      </button>
    </div>
  );
};

export default BottomToolbar;

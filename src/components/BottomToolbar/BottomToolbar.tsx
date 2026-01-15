const BottomToolbar = () => {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-[1030] flex h-[60px] items-center justify-around border-t border-gray-200 bg-white md:hidden">
      <button className="text-blue-600 no-underline hover:text-blue-800">Todo</button>
      <button className="text-blue-600 no-underline hover:text-blue-800">Mobile</button>
      <button className="text-blue-600 no-underline hover:text-blue-800">Toolbar</button>
    </div>
  );
};

export default BottomToolbar;

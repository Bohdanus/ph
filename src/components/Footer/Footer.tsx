import { useContext } from 'react';
import { ImageContext } from '../../contexts/ImageContext';

const Footer = () => {
  const { size, originalImage } = useContext(ImageContext);
  const { width, height } = size;

  return (
    <footer className="mt-auto border-t border-gray-200 bg-gray-100 py-2 dark:border-gray-700 dark:bg-gray-800 max-md:hidden [grid-area:footer]">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-4">
          {originalImage && width > 0 && height > 0 && (
            <span className="text-sm text-gray-600 dark:text-gray-300">
              Dimensions: {width} × {height} px
            </span>
          )}
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400">© 2025 Photo App</span>
      </div>
    </footer>
  );
};

export default Footer;

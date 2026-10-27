import { useStore } from '../../contexts/StoreContext.tsx';
import DevStatusStrip from '../DevStatusStrip/DevStatusStrip.tsx';

const Footer = () => {
  const [{ hasImage, totalSize }] = useStore();
  const { width, height } = totalSize;

  return (
    <footer className="mt-auto border-t border-gray-200 bg-gray-100 py-2 dark:border-gray-700 dark:bg-gray-800 max-md:hidden [grid-area:footer]">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-4">
          {hasImage && width > 0 && height > 0 && (
            <span data-testid="footer-dimensions" className="text-sm text-gray-600 dark:text-gray-300">
              Dimensions: {width} × {height} px
            </span>
          )}
          <DevStatusStrip />
        </div>
        {/* gray-500 measured 4.39:1 against the footer, under WCAG AA's 4.5:1. */}
        <span className="text-sm text-gray-600 dark:text-gray-300">© 2025 Photo App</span>
      </div>
    </footer>
  );
};

export default Footer;

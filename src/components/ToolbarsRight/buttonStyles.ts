/**
 * Button style constants for consistent styling across the application
 * Ensures proper contrast in both light and dark themes
 */

/**
 * Primary button style - Blue background, white text
 * Used for main actions (Apply, Save, Open File, etc.)
 */
export const PRIMARY_BUTTON =
  'rounded bg-blue-600 px-3 h-9 text-xs font-bold text-white transition-colors hover:bg-blue-700 focus:outline-none disabled:opacity-50';

/**
 * Primary button style - for larger buttons
 */
export const PRIMARY_BUTTON_LARGE =
  'rounded bg-blue-600 px-6 py-3 text-xl text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2';

/**
 * Secondary button style - Light gray background, dark text
 * Used for Cancel, Clear, secondary actions
 * Light theme: white bg with gray text, hover to light gray
 * Dark theme: gray-700 bg with gray text, hover to darker gray
 */
export const SECONDARY_BUTTON =
  'rounded border border-gray-300 bg-white px-3 h-9 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-900';

/**
 * Secondary button style - for larger buttons
 */
export const SECONDARY_BUTTON_LARGE =
  'rounded border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-900';

/**
 * Toggle button style - shows active/inactive states
 * Active: Blue background, white text with proper contrast
 * Inactive: Light gray background, dark text with hover effect
 * Light theme: white bg with gray text, hover to gray-200
 * Dark theme: gray-700 bg with gray text, hover to gray-900
 */
export const TOGGLE_BUTTON_ACTIVE =
  'border-blue-600 bg-blue-600 text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200';
export const TOGGLE_BUTTON_INACTIVE =
  'border-gray-300 bg-white text-gray-700 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-900';

/**
 * Icon button style - small button for icons with hover effect
 * Light theme: white bg with gray text, hover to light gray
 * Dark theme: gray-700 bg with gray text, hover to darker gray
 */
export const ICON_BUTTON =
  'rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-200 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-900';

/**
 * Small toggle button style (like mirror buttons)
 * Active: Blue background, white text
 * Inactive: Light gray background, dark text
 */
export const SMALL_TOGGLE_BUTTON_ACTIVE =
  'border-blue-600 bg-blue-600 text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200';
export const SMALL_TOGGLE_BUTTON_INACTIVE =
  'border-gray-300 bg-white text-gray-700 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-900';

/**
 * Text link button style - minimal button that looks like a link
 */
export const TEXT_LINK_BUTTON = 'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300';

/**
 * Icon-only button for visibility toggle
 * Maintains proper contrast in both themes
 */
export const ICON_TOGGLE_BUTTON_VISIBLE =
  'border-gray-300 text-gray-700 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 hover:border-gray-400 dark:hover:border-gray-500';
export const ICON_TOGGLE_BUTTON_HIDDEN =
  'border-gray-300 text-gray-400 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-500 hover:border-gray-400 dark:hover:border-gray-500';

/**
 * Delete/Remove button icon
 */
export const DELETE_BUTTON_ICON =
  'h-8 w-8 grid place-items-center rounded text-gray-500 hover:text-red-600 cursor-pointer dark:text-gray-400 dark:hover:text-red-400 hover:bg-white/70 dark:hover:bg-gray-700/40';

/**
 * Toolbar menu button style (like tools in the left sidebar)
 * Active: Blue background, white text
 * Inactive: Blue text, white/transparent background with hover effect
 * Light theme: blue text, hover to light blue background
 * Dark theme: blue text, hover to darker gray background
 */
export const TOOLBAR_MENU_BUTTON_ACTIVE = 'bg-blue-600 text-white';
export const TOOLBAR_MENU_BUTTON_INACTIVE = 'text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-gray-700';

/**
 * Menu item button style (used in dropdown menus)
 * Light theme: dark text, white/transparent background, hover to light gray
 * Dark theme: light text, transparent background, hover to darker gray
 */
export const MENU_ITEM_BUTTON =
  'w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700';

/**
 * Dialog button style for secondary actions (Cancel, Close)
 * Light theme: gray text, white background, hover to light gray
 * Dark theme: gray text, gray background, hover to darker gray
 */
export const DIALOG_SECONDARY_BUTTON =
  'mr-2 rounded px-4 py-2 font-bold text-gray-600 hover:bg-gray-200 focus:outline-none dark:text-gray-400 dark:hover:bg-gray-600';

/**
 * Transparent icon button on dark background (like history controls)
 * Used on dark headers/toolbars with white text
 * Increases opacity on hover for better visibility
 */
export const TRANSPARENT_DARK_ICON_BUTTON =
  'flex h-8 w-8 items-center justify-center rounded bg-transparent text-white opacity-75 hover:bg-gray-700 hover:opacity-100 disabled:opacity-25 disabled:hover:bg-transparent';

import { Select } from "antd";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listMoleculePage } from "../lib/api";
import { useLanguage } from "../i18n/LanguageContext";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

type Option = { value: string; label: ReactNode };

/**
 * Molecule chooser backed by a server-side search. Loading the whole library to fill a dropdown
 * does not survive a real dataset, so only a page of matches is fetched per keystroke burst.
 */
export default function MoleculePicker({
  value,
  onChange,
  placeholder,
  allowClear = false
}: {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const { t } = useLanguage();
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const latestRequest = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback(async (term: string) => {
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    setLoading(true);
    try {
      const page = await listMoleculePage({ search: term, page: 1, pageSize: PAGE_SIZE });
      // A slow earlier response must not replace the results of a newer search.
      if (request !== latestRequest.current) return;
      setOptions(
        page.items.map((molecule) => ({
          value: molecule.id,
          label: (
            <span translate="no">
              {molecule.name} ({molecule.id})
            </span>
          )
        }))
      );
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    search("");
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [search]);

  function handleSearch(term: string) {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(term), SEARCH_DEBOUNCE_MS);
  }

  return (
    <Select
      showSearch
      allowClear={allowClear}
      value={value}
      onChange={onChange}
      onSearch={handleSearch}
      filterOption={false}
      loading={loading}
      options={options}
      placeholder={placeholder}
      notFoundContent={loading ? t("ui.searching"): t("ui.noMatchingMolecule")}
    />
  );
}

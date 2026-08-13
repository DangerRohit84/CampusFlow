import { useState, useMemo } from 'react'

interface UseFilteredItemsProps<T> {
  items: T[]
  tabs: Array<{ key: string; label: string; count?: number }>
  filterFn: (item: T, tabKey: string) => boolean
  defaultTab?: string
}

export function useFilteredItems<T>({ items, tabs, filterFn, defaultTab }: UseFilteredItemsProps<T>) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.key || '')
  
  const filteredItems = useMemo(() => {
    return items.filter(item => filterFn(item, activeTab))
  }, [items, activeTab, filterFn])
  
  return { activeTab, setActiveTab, filteredItems }
}
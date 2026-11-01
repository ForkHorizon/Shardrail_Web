import { Button, Input, TextField } from 'react-aria-components';
import { Icon } from './Icon';

export type SessionSortOption = 'newest' | 'oldest' | 'name';

export function SessionFilterBar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortChange,
  totalCount,
  filteredCount,
  onResetFilters,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: string | null;
  onStatusFilterChange: (status: string | null) => void;
  sortBy: SessionSortOption;
  onSortChange: (sort: SessionSortOption) => void;
  totalCount: number;
  filteredCount: number;
  onResetFilters: () => void;
}) {
  const hasActiveFilters = searchQuery.length > 0 || statusFilter !== null;

  return (
    <div className="session-filter-bar" role="search" aria-label="Filter sessions">
      <div className="filter-input-row">
        <TextField
          className="search-field"
          aria-label="Search sessions"
          value={searchQuery}
          onChange={onSearchChange}
        >
          <div className="search-input-wrapper">
            <Icon className="icon search-icon" name="sessions" />
            <Input
              className="search-input"
              placeholder="Search sessions (id, workdir, model)…"
            />
            {searchQuery && (
              <Button
                className="clear-search-button"
                aria-label="Clear search"
                onPress={() => onSearchChange('')}
              >
                ✕
              </Button>
            )}
          </div>
        </TextField>

        <div className="sort-controls" role="group" aria-label="Sort sessions">
          <Button
            className={`sort-button${sortBy === 'newest' ? ' active' : ''}`}
            aria-pressed={sortBy === 'newest'}
            onPress={() => onSortChange('newest')}
          >
            Newest
          </Button>
          <Button
            className={`sort-button${sortBy === 'oldest' ? ' active' : ''}`}
            aria-pressed={sortBy === 'oldest'}
            onPress={() => onSortChange('oldest')}
          >
            Oldest
          </Button>
        </div>
      </div>

      <div className="filter-status-row">
        <div className="status-pills-group" role="group" aria-label="Filter by lifecycle status">
          <Button
            className={`filter-pill${statusFilter === null ? ' active' : ''}`}
            aria-pressed={statusFilter === null}
            onPress={() => onStatusFilterChange(null)}
          >
            All
          </Button>
          <Button
            className={`filter-pill${statusFilter === 'active' ? ' active' : ''}`}
            aria-pressed={statusFilter === 'active'}
            onPress={() => onStatusFilterChange(statusFilter === 'active' ? null : 'active')}
          >
            Active
          </Button>
          <Button
            className={`filter-pill${statusFilter === 'completed' ? ' active' : ''}`}
            aria-pressed={statusFilter === 'completed'}
            onPress={() => onStatusFilterChange(statusFilter === 'completed' ? null : 'completed')}
          >
            Completed
          </Button>
          <Button
            className={`filter-pill${statusFilter === 'failed' ? ' active' : ''}`}
            aria-pressed={statusFilter === 'failed'}
            onPress={() => onStatusFilterChange(statusFilter === 'failed' ? null : 'failed')}
          >
            Failed
          </Button>
        </div>

        <div className="filter-stats">
          <span className="count-label">
            {filteredCount === totalCount
              ? `${totalCount} ${totalCount === 1 ? 'session' : 'sessions'}`
              : `${filteredCount} of ${totalCount}`}
          </span>
          {hasActiveFilters && (
            <Button
              className="button-quiet reset-filters-button"
              aria-label="Reset filters"
              onPress={onResetFilters}
            >
              Reset
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

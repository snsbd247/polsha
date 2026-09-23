<?php

namespace App\Models\Concerns;

use App\Services\AuditLogger;
use Illuminate\Support\Str;

/**
 * Writes create/update/delete/restore of the model to audit_logs.
 * Models may define $auditModule and $auditExclude.
 */
trait Auditable
{
    public static function bootAuditable(): void
    {
        static::created(function ($model) {
            AuditLogger::log($model->auditModule(), 'create', $model, null, $model->auditFilter($model->getAttributes()));
        });

        static::updated(function ($model) {
            $new = $model->auditFilter($model->getChanges());
            if (! $new) {
                return;
            }
            $old = array_intersect_key($model->getOriginal(), $new);
            AuditLogger::log($model->auditModule(), 'update', $model, $old, $new);
        });

        static::deleted(function ($model) {
            AuditLogger::log($model->auditModule(), 'delete', $model, $model->auditFilter($model->getAttributes()));
        });

        if (method_exists(static::class, 'restored')) {
            static::restored(function ($model) {
                AuditLogger::log($model->auditModule(), 'restore', $model);
            });
        }
    }

    public function auditModule(): string
    {
        return property_exists($this, 'auditModule') ? $this->auditModule : Str::snake(class_basename($this));
    }

    protected function auditFilter(array $values): array
    {
        $exclude = array_merge(
            ['password', 'remember_token', 'created_at', 'updated_at'],
            property_exists($this, 'auditExclude') ? $this->auditExclude : [],
        );

        return array_diff_key($values, array_flip($exclude));
    }
}
